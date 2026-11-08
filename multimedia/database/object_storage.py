"""Private frame JPEGs in an S3-compatible object store (RustFS, or MinIO with the same code).

The database row keeps the same `image_path` key ("<session_id>/<frame_id>.jpg"); only where the
bytes live changes. Every failure is raised as an OSError subclass so FrameRepository keeps its
existing error handling, and no credentials or endpoint details appear in messages.
"""

from dataclasses import dataclass, field
from uuid import uuid4

QUARANTINE_PREFIX = ".quarantine/"


@dataclass(frozen=True)
class S3Settings:
    endpoint_url: str
    bucket: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)
    region: str = "us-east-1"


def _code(error) -> str:
    response = getattr(error, "response", None) or {}
    return str(response.get("Error", {}).get("Code", ""))


def _status(error) -> int:
    response = getattr(error, "response", None) or {}
    return int(response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0) or 0)


def _missing(error) -> bool:
    return _code(error) in ("404", "NoSuchKey", "NotFound") or _status(error) == 404


class S3ImageStore:
    """Write-once JPEG objects; the bucket stays private (no public URLs are created)."""

    def __init__(self, client, bucket: str):
        if not bucket:
            raise ValueError("bucket is required.")
        self.client = client
        self.bucket = bucket

    @classmethod
    def from_settings(cls, settings: S3Settings) -> "S3ImageStore":
        try:
            import boto3
            from botocore.config import Config
        except ImportError:
            raise OSError("boto3 is not installed; run pip install -r requirements.txt in multimedia/api.") from None
        client = boto3.client(
            "s3", endpoint_url=settings.endpoint_url, region_name=settings.region,
            aws_access_key_id=settings.access_key_id, aws_secret_access_key=settings.secret_access_key,
            config=Config(s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=15,
                          retries={"max_attempts": 2}),
        )
        return cls(client, settings.bucket)

    def ensure_bucket(self):
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return
        except Exception as error:
            if not _missing(error) and _code(error) != "NoSuchBucket":
                raise OSError("Object storage bucket check failed.") from None
        try:
            self.client.create_bucket(Bucket=self.bucket)
        except Exception as error:
            if _code(error) not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise OSError("Object storage bucket could not be created.") from None

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as error:
            if _missing(error):
                return False
            raise OSError("Object storage lookup failed.") from None

    def write_new(self, key: str, data: bytes):
        """Never overwrites: FileExistsError if the key is already present."""
        if self.exists(key):
            raise FileExistsError(key)
        try:
            # IfNoneMatch closes the race between the check and the write where the server supports it.
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType="image/jpeg",
                                   IfNoneMatch="*")
        except Exception as error:
            if _code(error) in ("PreconditionFailed", "ConditionalRequestConflict") or _status(error) == 412:
                raise FileExistsError(key) from None
            raise OSError("Object storage write failed.") from None

    def read(self, key: str) -> bytes:
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=key)
            return response["Body"].read()
        except Exception as error:
            if _missing(error):
                raise FileNotFoundError(key) from None
            raise OSError("Object storage read failed.") from None

    def delete(self, key: str):
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            raise OSError("Object storage delete failed.") from None

    def _copy(self, source: str, target: str):
        try:
            self.client.copy_object(Bucket=self.bucket, Key=target,
                                    CopySource={"Bucket": self.bucket, "Key": source})
        except Exception as error:
            if _missing(error):
                raise FileNotFoundError(source) from None
            raise OSError("Object storage copy failed.") from None

    def quarantine(self, key: str) -> str | None:
        """Moves the object aside before a row delete; returns the quarantine key (None if absent)."""
        if not self.exists(key):
            return None
        target = f"{QUARANTINE_PREFIX}{key}.deleted-{uuid4()}"
        self._copy(key, target)
        try:
            self.delete(key)
        except OSError:
            self.delete(target)
            raise
        return target

    def restore(self, quarantine_key: str, key: str):
        self._copy(quarantine_key, key)
        self.delete(quarantine_key)
