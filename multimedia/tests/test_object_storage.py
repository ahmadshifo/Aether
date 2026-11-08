"""Offline RustFS/S3 storage tests with an in-memory fake client (no network, no boto3 needed)."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import cv2
import numpy as np
import pymysql
import pytest
from sqlalchemy.exc import SQLAlchemyError

from database import connection
from database.connection import load_settings
from database.errors import (DatabaseConfigurationError, DuplicateFrameError, ImageStorageError,
                             RepositoryError, StorageConsistencyError)
from database.object_storage import QUARANTINE_PREFIX, S3ImageStore
from database.repository import FrameRepository

URL = "mysql+pymysql://unit:synthetic-secret@localhost/unit_db"


class FakeClientError(Exception):
    def __init__(self, code, status):
        super().__init__(code)
        self.response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}


class FakeBody:
    def __init__(self, data):
        self.data = data

    def read(self):
        return self.data


class FakeS3:
    """Just enough of the boto3 S3 client; `fail` makes the named call raise a 500."""

    def __init__(self):
        self.objects, self.buckets, self.fail = {}, set(), set()

    def _check(self, name):
        if name in self.fail:
            raise FakeClientError("InternalError", 500)

    def head_bucket(self, Bucket):
        self._check("head_bucket")
        if Bucket not in self.buckets:
            raise FakeClientError("404", 404)

    def create_bucket(self, Bucket):
        self._check("create_bucket")
        self.buckets.add(Bucket)

    def head_object(self, Bucket, Key):
        self._check("head_object")
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("404", 404)

    def put_object(self, Bucket, Key, Body, ContentType, IfNoneMatch):
        self._check("put_object")
        if IfNoneMatch == "*" and (Bucket, Key) in self.objects:
            raise FakeClientError("PreconditionFailed", 412)
        self.objects[(Bucket, Key)] = bytes(Body)

    def get_object(self, Bucket, Key):
        self._check("get_object")
        if (Bucket, Key) not in self.objects:
            raise FakeClientError("NoSuchKey", 404)
        return {"Body": FakeBody(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self._check("delete_object")
        self.objects.pop((Bucket, Key), None)

    def copy_object(self, Bucket, Key, CopySource):
        self._check("copy_object")
        source = (CopySource["Bucket"], CopySource["Key"])
        if source not in self.objects:
            raise FakeClientError("NoSuchKey", 404)
        self.objects[(Bucket, Key)] = self.objects[source]

    def keys(self):
        return sorted(key for _, key in self.objects)


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    for name in ("DATABASE_URL", "FRAME_STORAGE_PATH", "FRAME_RETENTION_HOURS", "FRAME_STORAGE_BACKEND",
                 "S3_ENDPOINT_URL", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(connection, "ENV_FILE", tmp_path / "absent.env")
    monkeypatch.setattr(pymysql, "connect", lambda *args, **kwargs: pytest.fail("Offline tests must not connect"))


@pytest.fixture
def image():
    return np.full((48, 64, 3), 150, dtype=np.uint8)


@pytest.fixture
def s3_repository(tmp_path):
    client = FakeS3()
    store = S3ImageStore(client, "aether-frames")
    store.ensure_bucket()
    session = MagicMock()
    session.__enter__.return_value = session
    captured = {}

    def flush():
        row = captured.get("row")
        if row is not None:
            row.created_at = datetime(2026, 1, 1, tzinfo=UTC)
            row.expires_at = row.created_at + timedelta(hours=24)

    session.add.side_effect = lambda row: captured.__setitem__("row", row)
    session.flush.side_effect = flush
    session.get.side_effect = lambda cls, key: captured.get("row") if captured.get("row") is not None and captured["row"].frame_id == key else None
    repository = FrameRepository(MagicMock(return_value=session), tmp_path / "images", image_store=store)
    return repository, session, captured, client


def save(repository, image, **kwargs):
    return repository.save_frame(kwargs.pop("session_id", uuid4()), datetime(2020, 1, 1, tzinfo=UTC), image, **kwargs)


def test_settings_default_to_local_disk():
    settings = load_settings(database_url=URL)
    assert settings.storage_backend == "local" and settings.s3 is None


def test_s3_settings_from_env_file_hide_secrets(tmp_path, monkeypatch):
    env = tmp_path / "s3.env"
    env.write_text(f"DATABASE_URL={URL}\nFRAME_STORAGE_BACKEND=s3\nS3_ENDPOINT_URL=http://localhost:9000\n"
                   "S3_BUCKET=unit-frames\nS3_ACCESS_KEY_ID=unit-access\nS3_SECRET_ACCESS_KEY=unit-secret-value\n",
                   encoding="utf-8")
    monkeypatch.setattr(connection, "ENV_FILE", env)
    settings = load_settings()
    assert settings.storage_backend == "s3"
    assert (settings.s3.endpoint_url, settings.s3.bucket, settings.s3.region) == ("http://localhost:9000", "unit-frames", "us-east-1")
    assert "unit-secret-value" not in repr(settings) and "unit-access" not in repr(settings)


@pytest.mark.parametrize("missing", ["S3_ENDPOINT_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
def test_s3_backend_requires_endpoint_and_keys(monkeypatch, missing):
    values = {"S3_ENDPOINT_URL": "http://localhost:9000", "S3_ACCESS_KEY_ID": "a", "S3_SECRET_ACCESS_KEY": "unit-secret"}
    for name, value in values.items():
        if name != missing:
            monkeypatch.setenv(name, value)
    with pytest.raises(DatabaseConfigurationError) as error:
        load_settings(database_url=URL, storage_backend="s3")
    assert "unit-secret" not in str(error.value)


def test_unknown_backend_rejected():
    with pytest.raises(DatabaseConfigurationError):
        load_settings(database_url=URL, storage_backend="ftp")


def test_ensure_bucket_creates_missing_bucket_once():
    client = FakeS3()
    store = S3ImageStore(client, "aether-frames")
    store.ensure_bucket()
    store.ensure_bucket()
    assert client.buckets == {"aether-frames"}


def test_round_trip_keeps_same_image_path_key_and_no_local_files(s3_repository, image):
    repository, _, captured, client = s3_repository
    session_id = uuid4()
    identifier = save(repository, image, session_id=session_id, ocr_text="ROOM 205")
    assert captured["row"].image_path == f"{session_id}/{identifier}.jpg"
    assert client.keys() == [captured["row"].image_path]
    decoded = cv2.imdecode(np.frombuffer(repository.load_frame_image(identifier), np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == image.shape
    assert repository.image_exists(repository.get_frame(identifier))
    assert not repository.storage_root.exists()


def test_existing_object_is_never_overwritten(s3_repository, image):
    repository, session, _, client = s3_repository
    identifier, session_id = uuid4(), uuid4()
    client.objects[("aether-frames", f"{session_id}/{identifier}.jpg")] = b"original"
    with pytest.raises(DuplicateFrameError):
        save(repository, image, session_id=session_id, frame_id=identifier)
    assert client.objects[("aether-frames", f"{session_id}/{identifier}.jpg")] == b"original"
    session.add.assert_not_called()


def test_upload_failure_inserts_no_row(s3_repository, image):
    repository, session, _, client = s3_repository
    client.fail.add("put_object")
    with pytest.raises(ImageStorageError):
        save(repository, image)
    session.add.assert_not_called()
    assert client.keys() == []


def test_insert_failure_removes_new_object(s3_repository, image):
    repository, session, _, client = s3_repository
    session.flush.side_effect = SQLAlchemyError("private details")
    with pytest.raises(RepositoryError):
        save(repository, image)
    assert client.keys() == []


def test_uncertain_commit_retains_object(s3_repository, image):
    repository, session, _, client = s3_repository
    session.commit.side_effect = SQLAlchemyError("private details")
    with pytest.raises(StorageConsistencyError):
        save(repository, image)
    assert len(client.keys()) == 1


def test_unavailable_object_raises_storage_error(s3_repository, image):
    repository, _, captured, client = s3_repository
    identifier = save(repository, image)
    client.objects.clear()
    with pytest.raises(ImageStorageError):
        repository.load_frame_image(identifier)


def test_delete_removes_row_and_object(s3_repository, image):
    repository, session, captured, client = s3_repository
    identifier = save(repository, image)
    session.scalar.return_value = captured["row"]
    assert repository.delete_frame(identifier)
    assert client.keys() == []
    session.delete.assert_called_once_with(captured["row"])


def test_delete_failure_restores_object(s3_repository, image):
    repository, session, captured, client = s3_repository
    identifier = save(repository, image)
    key = captured["row"].image_path
    session.scalar.return_value = captured["row"]
    session.flush.side_effect = SQLAlchemyError("private details")
    with pytest.raises(RepositoryError):
        repository.delete_frame(identifier)
    assert client.keys() == [key]


def test_delete_uncertain_commit_keeps_quarantined_copy(s3_repository, image):
    repository, session, captured, client = s3_repository
    identifier = save(repository, image)
    session.scalar.return_value = captured["row"]
    session.commit.side_effect = SQLAlchemyError("private details")
    with pytest.raises(StorageConsistencyError, match="uncertain"):
        repository.delete_frame(identifier)
    assert len(client.keys()) == 1 and client.keys()[0].startswith(QUARANTINE_PREFIX)


def test_delete_with_missing_object_still_deletes_row(s3_repository, image):
    repository, session, captured, client = s3_repository
    identifier = save(repository, image)
    client.objects.clear()
    session.scalar.return_value = captured["row"]
    assert repository.delete_frame(identifier)


def test_from_database_reports_unreachable_storage(monkeypatch, tmp_path):
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://localhost:9000")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "a")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "unit-secret")
    settings = load_settings(database_url=URL, storage_path=tmp_path, storage_backend="s3")
    broken = FakeS3()
    broken.fail.add("head_bucket")
    monkeypatch.setattr(S3ImageStore, "from_settings", classmethod(lambda cls, s: cls(broken, s.bucket)))
    database = MagicMock(settings=settings)
    with pytest.raises(ImageStorageError, match="RustFS"):
        FrameRepository.from_database(database)
