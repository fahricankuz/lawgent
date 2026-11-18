"""Embedding sağlayıcıları. Varsayılan: kapalı (yalnızca tam metin arama).

bge-m3: çok dilli, 1024 boyut, Türkçe'de güçlü; kendi GPU'muzda çalışır, veri dışarı çıkmaz.
"""
from __future__ import annotations

from typing import Protocol

class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]: ...


class SentenceTransformerEmbedder:
    def __init__(self, model: str, dim: int):
        from sentence_transformers import SentenceTransformer  # isteğe bağlı bağımlılık

        self.model = SentenceTransformer(model)
        self.dim = dim

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]:
        vecs = self.model.encode(texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
        return [v.tolist() for v in vecs]


def create_embedder(provider: str, model: str = "BAAI/bge-m3", dim: int = 1024) -> Embedder | None:
    if provider == "none":
        return None
    if provider == "bge-m3":
        return SentenceTransformerEmbedder(model, dim)
    raise ValueError(f"Bilinmeyen EMBEDDING_PROVIDER: {provider}")
