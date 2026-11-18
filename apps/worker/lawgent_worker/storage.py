from pathlib import Path

from .config import Config


class FsStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def get(self, key: str) -> bytes:
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root) + "/"):
            raise ValueError("Geçersiz nesne anahtarı")
        return p.read_bytes()


class S3Storage:
    def __init__(self, cfg: Config):
        import boto3

        self.bucket = cfg.s3_bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=cfg.s3_endpoint,
            region_name=cfg.s3_region,
            aws_access_key_id=cfg.s3_access_key,
            aws_secret_access_key=cfg.s3_secret_key,
        )

    def get(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()


def create_storage(cfg: Config):
    return FsStorage(cfg.storage_fs_root) if cfg.storage_driver == "fs" else S3Storage(cfg)
