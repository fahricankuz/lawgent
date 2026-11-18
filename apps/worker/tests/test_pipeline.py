"""Worker uçtan uca: kuyruk → şifre çözme → OCR → parçalar (RLS altında, worker rolüyle)."""
import base64
import os
import uuid
from pathlib import Path

import psycopg
import pytest

from lawgent_worker.crypto import LocalKeyWrapper, derive_key, seal
from lawgent_worker.main import run_once
from lawgent_worker.pipeline import Deps
from lawgent_worker.storage import FsStorage

OWNER = os.environ.get("TEST_DATABASE_OWNER_URL", "postgresql://lawgent_owner:lawgent_owner@localhost:5432/lawgent_test")
WORKER = os.environ.get("TEST_DATABASE_WORKER_URL", "postgresql://lawgent_worker:lawgent_worker@localhost:5432/lawgent_test")
FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "demo"


@pytest.fixture()
def env(tmp_path):
    try:
        owner = psycopg.connect(OWNER, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("test veritabanı yok")
    mk = base64.b64encode(os.urandom(32)).decode()
    wrapper = LocalKeyWrapper(mk)
    dek = os.urandom(32)
    kek = base64.b64decode(mk)
    tenant, user, client, matter = (str(uuid.uuid4()) for _ in range(4))
    owner.execute("update jobs set status = 'done' where status in ('queued', 'running')")
    owner.execute("insert into tenants (id, name, slug) values (%s, 'Test Hukuk', %s)", (tenant, "t-" + tenant[:8]))
    owner.execute("insert into tenant_keys values (%s, %s, %s)", (tenant, seal(kek, dek, b"dek"), wrapper.kek_id))
    owner.execute("insert into users (id, email, full_name, password_hash) values (%s, %s, 'Test', 'x')", (user, f"{user}@t.tr"))
    owner.execute("insert into tenant_members values (%s, %s, 'lawyer')", (tenant, user))
    owner.execute("insert into clients (tenant_id, id, kind, display_name, created_by) values (%s,%s,'company','X A.Ş.',%s)", (tenant, client, user))
    owner.execute("insert into matters (tenant_id, id, client_id, type, title, created_by) values (%s,%s,%s,'dava','Kira',%s)", (tenant, matter, client, user))
    store = FsStorage(str(tmp_path))
    yield dict(owner=owner, wrapper=wrapper, dek=dek, tenant=tenant, user=user, matter=matter, store=store, tmp=tmp_path)
    owner.close()


def upload(env, fixture: str, mime: str) -> tuple[str, str]:
    doc, ver = str(uuid.uuid4()), str(uuid.uuid4())
    key = f"{env['tenant']}/{env['matter']}/{doc}/{ver}"
    data = (FIXTURES / fixture).read_bytes()
    path = env["tmp"] / key
    path.parent.mkdir(parents=True)
    path.write_bytes(seal(derive_key(env["dek"], "object"), data, key.encode()))
    o = env["owner"]
    with o.transaction():
        o.execute("insert into documents (tenant_id, id, matter_id, title, created_by) values (%s,%s,%s,%s,%s)",
                  (env["tenant"], doc, env["matter"], fixture, env["user"]))
        o.execute(
            """insert into document_versions (tenant_id, id, document_id, matter_id, object_key, file_name, mime_type,
                                             size_bytes, sha256, created_by)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (env["tenant"], ver, doc, env["matter"], key, fixture, mime, len(data), b"\0" * 32, env["user"]),
        )
    return doc, ver


def test_ingest_lease_and_scanned_notice(env):
    _, lease = upload(env, "kira-sozlesmesi.pdf", "application/pdf")
    _, notice = upload(env, "ihtarname-taranmis.pdf", "application/pdf")
    with psycopg.connect(WORKER, autocommit=True) as conn:
        deps = Deps(conn, env["store"], env["wrapper"], None)
        while run_once(deps):
            pass

    o = env["owner"]
    status = dict(o.execute("select id::text, ocr_status::text from document_versions where id in (%s, %s)", (lease, notice)).fetchall())
    assert status == {lease: "done", notice: "done"}
    page, ref = o.execute(
        "select page_from, article_ref from chunks where version_id = %s and content like %s", (lease, "%Tüketici Fiyat Endeksi%")
    ).fetchone()
    assert (page, ref) == (4, "m.7.2")
    # Türkçe tam metin (VEYA mantığı); en iyi eşleşme TÜFE maddesi olmalı.
    best = o.execute(
        """select article_ref from chunks where version_id = %s and tsv @@ app.tr_tsquery_or(%s)
           order by ts_rank_cd(tsv, app.tr_tsquery_or(%s)) desc limit 1""",
        (lease, "TÜFE oranında kira artışı", "TÜFE oranında kira artışı"),
    ).fetchone()
    assert best == ("m.7.2",)
    # Türkçe büyük I: "İHTARNAME" ve "ihtarname" aynı terime iner.
    assert o.execute("select app.tr_tsvector('IŞIK İHTARNAME') = app.tr_tsvector('ışık ihtarname')").fetchone()[0]
    ocr_text = o.execute("select string_agg(content, ' ') from chunks where version_id = %s", (notice,)).fetchone()[0]
    assert "312.000 TL" in ocr_text
    actions = [r[0] for r in o.execute("select actor_kind from audit_events where tenant_id = %s and action = 'document.ingested'", (env["tenant"],))]
    assert actions == ["worker", "worker"]


def test_worker_cannot_write_other_tenant(env):
    other = str(uuid.uuid4())
    with psycopg.connect(WORKER, autocommit=True) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        with conn.transaction():
            conn.execute("select set_config('app.tenant_id', %s, true)", (other,))
            conn.execute(
                "insert into document_pages (tenant_id, version_id, matter_id, page_no, text) values (%s, %s, %s, 1, 'x')",
                (env["tenant"], str(uuid.uuid4()), env["matter"]),
            )
