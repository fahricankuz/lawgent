"""Yükleme hattı: depodan al → çöz → sayfa metni → parçala → embedding → yaz.

Uzun süren adımlar (OCR, embedding) transaction dışında yapılır. Her yazma işlemi,
işin ait olduğu büronun bağlamında (app.tenant_id) yapılır; RLS başka büroya yazmayı engeller.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import psycopg
from psycopg.types.json import Jsonb

from .chunking import chunk_pages
from .crypto import LocalKeyWrapper, derive_key, open_sealed
from .embed import Embedder
from .extract import extract

log = logging.getLogger("lawgent.worker")


@dataclass
class Deps:
    conn: psycopg.Connection
    storage: object
    keys: LocalKeyWrapper
    embedder: Embedder | None
    ocr_lang: str = "tur"


def _set_tenant(cur: psycopg.Cursor, tenant_id: str) -> None:
    cur.execute("select set_config('app.tenant_id', %s, true)", (str(tenant_id),))


def _vec(v: list[float] | None) -> str | None:
    return None if v is None else "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def ingest_version(deps: Deps, tenant_id: str, version_id: str) -> dict:
    conn = deps.conn
    with conn.transaction():
        cur = conn.cursor()
        _set_tenant(cur, tenant_id)
        cur.execute(
            "select document_id, matter_id, object_key, mime_type from document_versions where id = %s",
            (version_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise LookupError("Versiyon bulunamadı")
        document_id, matter_id, object_key, mime = row
        cur.execute("update document_versions set ocr_status = 'processing', ocr_error = null where id = %s", (version_id,))
        cur.execute("select wrapped_dek from tenant_keys where tenant_id = %s", (str(tenant_id),))
        (wrapped,) = cur.fetchone()

    dek = deps.keys.unwrap(bytes(wrapped))
    plain = open_sealed(derive_key(dek, "object"), deps.storage.get(object_key), object_key.encode())
    pages = extract(plain, mime, deps.ocr_lang)
    chunks = chunk_pages(pages)
    vectors: list[list[float] | None] = [None] * len(chunks)
    if deps.embedder and chunks:
        vectors = deps.embedder.embed([c.content for c in chunks])

    with conn.transaction():
        cur = conn.cursor()
        _set_tenant(cur, tenant_id)
        cur.execute("delete from chunks where version_id = %s", (version_id,))
        cur.execute("delete from document_pages where version_id = %s", (version_id,))
        # COPY, RLS altında desteklenmez; toplu INSERT kullanılır.
        cur.executemany(
            "insert into document_pages (tenant_id, version_id, matter_id, page_no, text) values (%s, %s, %s, %s, %s)",
            [(tenant_id, version_id, matter_id, p.page_no, p.text.replace("\x00", "")) for p in pages],
        )
        cur.executemany(
            """insert into chunks (tenant_id, matter_id, document_id, version_id, ordinal, page_from, page_to,
                                   article_ref, content, embedding)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector)""",
            [
                (tenant_id, matter_id, document_id, version_id, c.ordinal, c.page_from, c.page_to,
                 c.article_ref, c.content.replace("\x00", ""), _vec(v))
                for c, v in zip(chunks, vectors)
            ],
        )
        cur.execute(
            """update document_versions set ocr_status = 'done', page_count = %s, processed_at = now(), ocr_error = null
               where id = %s""",
            (len(pages), version_id),
        )
        stats = {
            "pages": len(pages),
            "ocrPages": sum(1 for p in pages if p.ocr),
            "chunks": len(chunks),
            "embedded": deps.embedder is not None,
        }
        cur.execute(
            "select app.audit('document.ingested', 'document_version', %s, %s, %s, null)",
            (version_id, matter_id, Jsonb(stats)),
        )
    return stats


def mark_failed(conn: psycopg.Connection, tenant_id: str, version_id: str, error: str) -> None:
    with conn.transaction():
        cur = conn.cursor()
        _set_tenant(cur, tenant_id)
        cur.execute(
            "update document_versions set ocr_status = 'failed', ocr_error = %s where id = %s",
            (error[:500], version_id),
        )
