import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    database_url: str = field(default_factory=lambda: os.environ["DATABASE_WORKER_URL"])
    master_key: str = field(default_factory=lambda: os.environ["MASTER_KEY"])
    storage_driver: str = field(default_factory=lambda: os.environ.get("STORAGE_DRIVER", "s3"))
    storage_fs_root: str = field(default_factory=lambda: os.environ.get("STORAGE_FS_ROOT", ".data/objects"))
    s3_endpoint: str | None = field(default_factory=lambda: os.environ.get("S3_ENDPOINT"))
    s3_region: str = field(default_factory=lambda: os.environ.get("S3_REGION", "tr-ist-1"))
    s3_access_key: str | None = field(default_factory=lambda: os.environ.get("S3_ACCESS_KEY"))
    s3_secret_key: str | None = field(default_factory=lambda: os.environ.get("S3_SECRET_KEY"))
    s3_bucket: str = field(default_factory=lambda: os.environ.get("S3_BUCKET", "lawgent-documents"))
    # none | bge-m3 (sentence-transformers) | http (harici embedding sunucusu, ör. TEI)
    embedding_provider: str = field(default_factory=lambda: os.environ.get("EMBEDDING_PROVIDER", "none"))
    embedding_model: str = field(default_factory=lambda: os.environ.get("EMBEDDING_MODEL", "BAAI/bge-m3"))
    embedding_dim: int = field(default_factory=lambda: int(os.environ.get("EMBEDDING_DIM", "1024")))
    ocr_lang: str = field(default_factory=lambda: os.environ.get("OCR_LANG", "tur"))
    poll_seconds: float = field(default_factory=lambda: float(os.environ.get("WORKER_POLL_SECONDS", "2")))
