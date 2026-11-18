"""İş döngüsü: Postgres kuyruğundan (FOR UPDATE SKIP LOCKED) iş alır. Birden çok kopya güvenle çalışır."""
from __future__ import annotations

import logging
import signal
import time

import psycopg

from .config import Config
from .crypto import LocalKeyWrapper
from .embed import create_embedder
from .pipeline import Deps, ingest_version, mark_failed
from .storage import create_storage

log = logging.getLogger("lawgent.worker")
KINDS = ["ingest_version"]


def run_once(deps: Deps) -> bool:
    """Bir iş işler; iş yoksa False döner."""
    conn = deps.conn
    with conn.transaction():
        job = conn.execute("select id, tenant_id, kind, payload, attempts from app.claim_job(%s)", (KINDS,)).fetchone()
    if job is None:
        return False
    job_id, tenant_id, kind, payload, attempts = job
    version_id = payload.get("version_id")
    try:
        stats = ingest_version(deps, str(tenant_id), version_id)
        with conn.transaction():
            conn.execute("select app.finish_job(%s, true, null)", (job_id,))
        log.info("iş %s tamam: %s", job_id, stats)
    except Exception as e:  # noqa: BLE001 — her hata kaydedilir, iş yeniden denenir
        log.exception("iş %s başarısız (deneme %s)", job_id, attempts)
        msg = f"{type(e).__name__}: {e}"
        with conn.transaction():
            conn.execute("select app.finish_job(%s, false, %s)", (job_id, msg[:1000]))
        if attempts >= 5:
            mark_failed(conn, str(tenant_id), version_id, msg)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = Config()
    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    with psycopg.connect(cfg.database_url, autocommit=True) as conn:
        deps = Deps(conn, create_storage(cfg), LocalKeyWrapper(cfg.master_key), create_embedder(cfg.embedding_provider, cfg.embedding_model, cfg.embedding_dim), cfg.ocr_lang)
        log.info("worker başladı (embedding: %s)", cfg.embedding_provider)
        while not stop:
            if not run_once(deps):
                time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
