"""API'nin soru embedding'i için iç ağ servisi (dışarıya açılmaz).

Çalıştırma: EMBEDDING_PROVIDER=bge-m3 uvicorn lawgent_worker.embed_server:app --port 8001
"""
import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .embed import create_embedder

PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "none")
embedder = create_embedder(
    PROVIDER, os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3"), int(os.environ.get("EMBEDDING_DIM", "1024"))
)
app = FastAPI(title="Lawgent embedding", docs_url=None, redoc_url=None)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)
    kind: str = "query"


@app.post("/embed")
def embed(req: EmbedRequest):
    if embedder is None:
        raise HTTPException(503, "Embedding kapalı")
    return {"vectors": embedder.embed(req.texts, req.kind), "dim": embedder.dim}


@app.get("/health")
def health():
    return {"ok": True, "provider": PROVIDER}
