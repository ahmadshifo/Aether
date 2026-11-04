"""Offline repository tests. Mocks do not claim to verify MySQL."""

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import cv2
import numpy as np
import pymysql
import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from database import connection
from database.connection import Database, DatabaseSettings, load_settings
from database.errors import (DatabaseConfigurationError, DatabaseConnectionError,
                             DuplicateFrameError, ImageStorageError, RepositoryError, StorageConsistencyError)
from database.models import EMBEDDING_MODEL, Frame
from database.repository import FrameCursor, FrameRecord, FrameRepository
from database.schema import SCHEMA_FILE, render_schema
from database.validation import as_utc, as_uuid, validate_embedding, video_milliseconds


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    for name in ("DATABASE_URL", "FRAME_STORAGE_PATH", "FRAME_RETENTION_HOURS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(connection, "ENV_FILE", tmp_path / "absent.env")
    monkeypatch.setattr(pymysql, "connect", lambda *args, **kwargs: pytest.fail("Offline tests must not connect"))


@pytest.fixture
def image():
    return np.full((48, 64, 3), 150, dtype=np.uint8)


@pytest.fixture
def mocked_repository(tmp_path):
    session = MagicMock()
    session.__enter__.return_value = session
    factory = MagicMock(return_value=session)
    captured = {}

    def add(row):
        captured["row"] = row

    def flush():
        row = captured.get("row")
        if row is not None:
            # Synthetic fixture values only; server defaults are tested separately.
            row.created_at = datetime(2026, 1, 1, tzinfo=UTC)
            row.expires_at = row.created_at + timedelta(hours=24)

    session.add.side_effect = add
    session.flush.side_effect = flush
    session.get.side_effect = lambda cls, key: captured.get("row") if captured.get("row") is not None and captured["row"].frame_id == key else None
    repository = FrameRepository(factory, tmp_path / "images")
    return repository, session, captured


def save(repository, image, **kwargs):
    return repository.save_frame(kwargs.pop("session_id", uuid4()),
                                 kwargs.pop("captured_at", datetime(2020, 1, 1, tzinfo=UTC)),
                                 image, **kwargs)


def test_configuration_precedence_and_consistent_paths(tmp_path, monkeypatch):
    env = tmp_path / "settings.env"
    env.write_text("DATABASE_URL=mysql+pymysql://unit:synthetic-secret@localhost/unit_db\n"
                   "FRAME_STORAGE_PATH=./stored_frames\nFRAME_RETENTION_HOURS=24\n", encoding="utf-8")
    monkeypatch.setattr(connection, "ENV_FILE", env)
    settings = load_settings()
    assert settings.storage_root == connection.PROJECT_ROOT / "stored_frames"
    assert settings.url.drivername == "mysql+pymysql" and settings.retention_hours == 24
    assert "synthetic-secret" not in repr(settings)
    monkeypatch.setenv("FRAME_RETENTION_HOURS", "48")
    assert load_settings().retention_hours == 48


def test_missing_configuration():
    with pytest.raises(DatabaseConfigurationError, match="DATABASE_URL is missing"):
        load_settings()


@pytest.mark.parametrize("url", ["bad-secret", "sqlite:///file.db", "postgresql://u:secret@localhost/db"])
def test_invalid_urls_do_not_disclose_password(url):
    with pytest.raises(DatabaseConfigurationError) as caught:
        load_settings(database_url=url)
    assert "secret" not in str(caught.value)


def test_no_connection_on_engine_construction_and_controlled_failure(tmp_path):
    settings = DatabaseSettings(make_url("mysql+pymysql://u:synthetic-secret@localhost/unit"), tmp_path)
    engine = MagicMock()
    with patch("database.connection.create_db_engine", return_value=engine):
        database = Database(settings)
        engine.connect.assert_not_called()
        engine.connect.side_effect = SQLAlchemyError("synthetic-secret")
        with pytest.raises(DatabaseConnectionError) as caught:
            database.check()
        assert "synthetic-secret" not in str(caught.value)
        database.close()
        engine.dispose.assert_called_once()


def test_check_reports_actual_mocked_values_and_closes_connection(tmp_path):
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value.scalar.side_effect = ["8.4.8", "MySQL Community Server - GPL"]
    settings = DatabaseSettings(make_url("mysql+pymysql://u:fake@localhost/db"), tmp_path)
    with patch("database.connection.create_db_engine", return_value=engine), \
            patch.object(Database, "_validate_schema"), patch("database.connection.inspect") as inspector:
        inspector.return_value.get_indexes.return_value = [
            {"name": "frames_session_time_idx"}, {"name": "frames_expires_at_idx"}]
        info = Database(settings).check()
    assert info == dict(mysql_version="8.4.8", frames_table="frames")
    engine.connect.return_value.__exit__.assert_called_once()


def test_models_and_schema_stay_identical_and_generation_repeatable():
    required = {"frame_id", "session_id", "captured_at", "source_frame_index", "video_timestamp_ms",
                "image_path", "ocr_text", "objects", "caption", "embedding", "embedding_model", "created_at", "expires_at"}
    assert set(Frame.__table__.columns.keys()) == required
    assert isinstance(Frame.__table__.c.embedding.type, mysql.JSON)
    assert Frame.__table__.c.embedding.type.none_as_null
    assert Frame.__table__.c.embedding.nullable
    assert Frame.__table__.c.captured_at.type.impl.fsp == 6
    assert SCHEMA_FILE.read_text(encoding="utf-8") == render_schema() == render_schema()
    assert {index.name for index in Frame.__table__.indexes} == {"frames_session_time_idx", "frames_expires_at_idx"}


@pytest.mark.parametrize("bad", ["bad", "../path", 123, None])
def test_invalid_uuid_rejected(bad):
    with pytest.raises(ValueError, match="UUID"):
        as_uuid(bad, "frame_id")


def test_timezone_normalization_and_fractional_video_position():
    assert as_utc(datetime(2020, 1, 1, 2, tzinfo=timezone(timedelta(hours=2)))).hour == 0
    assert as_utc("2020-01-01T00:00:00Z") == datetime(2020, 1, 1, tzinfo=UTC)
    assert video_milliseconds(999.5) == 1000
    with pytest.raises(ValueError):
        as_utc(datetime(2020, 1, 1))


@pytest.mark.parametrize("bad", [-1, float("nan"), float("inf"), 1e50, True])
def test_invalid_video_positions(bad):
    with pytest.raises(ValueError):
        video_milliseconds(bad)


def test_jpeg_and_metadata_round_trip_with_mock_session(mocked_repository, image):
    repository, session, captured = mocked_repository
    original = image.copy()
    labels = ["door", "sign"]
    frame_id = save(repository, image, ocr_text="ROOM 205", objects=labels,
                    caption="A door.", source_frame_index=30, video_timestamp_ms=1000.25)
    assert isinstance(frame_id, UUID)
    session.commit.assert_called_once()
    session.__exit__.assert_called_once()
    record = repository.get_frame(frame_id)
    assert isinstance(record, FrameRecord)
    assert record.objects == labels and record.ocr_text == "ROOM 205"
    assert record.source_frame_index == 30 and record.video_timestamp_ms == 1000
    assert record.created_at > record.captured_at
    data = repository.load_frame_image(frame_id)
    assert cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR).shape == image.shape
    np.testing.assert_array_equal(image, original)
    record.objects.append("chair")
    assert captured["row"].objects == labels  # Returned metadata is detached.


def test_optional_metadata_and_missing_records(mocked_repository, image):
    repository, session, _ = mocked_repository
    identifier = save(repository, image)
    result = repository.get_frame(identifier)
    assert result.ocr_text == result.caption == "" and result.objects == []
    assert result.embedding is result.embedding_model is None
    assert repository.get_embedding(identifier) is None
    assert repository.get_frame(uuid4()) is None
    assert repository.load_frame_image(uuid4()) is None


@pytest.mark.parametrize("bad", [None, np.empty((0, 0), dtype=np.uint8), np.zeros((2, 2), dtype=np.float32)])
def test_invalid_images_not_saved(mocked_repository, bad):
    repository, session, _ = mocked_repository
    with pytest.raises((ValueError, TypeError)):
        save(repository, bad)
    session.add.assert_not_called()
    assert not repository.storage_root.exists()


@pytest.mark.parametrize("objects", ["door,sign", [1], [""]])
def test_invalid_object_metadata(mocked_repository, image, objects):
    with pytest.raises(TypeError):
        save(mocked_repository[0], image, objects=objects)


def test_valid_embedding_and_existing_task_results(mocked_repository, image):
    from processing.ocr_service import OCRResult
    from processing.object_detector import VisionResult
    from processing.embedding_service import EmbeddingResult
    repository, _, _ = mocked_repository
    ocr = OCRResult("ROOM 205", "mistral-ocr-latest", True, "ROOM 205")
    vision = VisionResult(["door", "sign"], "A door.", "gpt-5.4-mini", False)
    embedding = EmbeddingResult(EMBEDDING_MODEL, 1536, "A door.", np.linspace(-0.5, 0.5, 1536).tolist())
    identifier = save(repository, image, ocr_text=ocr.text, objects=vision.objects, caption=vision.caption,
                      embedding=embedding.embedding, embedding_model=embedding.model)
    stored = repository.get_embedding(identifier)
    assert stored.model == EMBEDDING_MODEL and stored.dimensions == 1536
    assert np.allclose(stored.embedding, embedding.embedding, atol=1e-7)
    assert vision.objects == ["door", "sign"]


@pytest.mark.parametrize("values, model", [
    ([1] * 1535, EMBEDDING_MODEL), ([float("nan")] * 1536, EMBEDDING_MODEL),
    ([float("inf")] * 1536, EMBEDDING_MODEL), ([10**400] * 1536, EMBEDDING_MODEL),
    ([True] * 1536, EMBEDDING_MODEL), ([0] * 1536, EMBEDDING_MODEL),
    ([1] * 1536, "wrong-model"), ([1] * 1536, None), (None, EMBEDDING_MODEL),
])
def test_embedding_validation(values, model):
    with pytest.raises((ValueError, TypeError)):
        validate_embedding(values, model)


@pytest.mark.parametrize("path", ["../outside.jpg", "nested/../../outside.jpg", "C:/outside.jpg", "/outside.jpg", ""])
def test_storage_path_boundary(mocked_repository, path):
    with pytest.raises(ImageStorageError):
        mocked_repository[0]._safe_path(path)


def test_tampered_db_path_cannot_read_arbitrary_file(mocked_repository, image):
    repository, _, captured = mocked_repository
    identifier = save(repository, image)
    captured["row"].image_path = "../outside.jpg"
    with pytest.raises(ImageStorageError):
        repository.load_frame_image(identifier)


def test_redirected_path_cannot_target_another_private_frame(mocked_repository, monkeypatch):
    repository, _, _ = mocked_repository
    original = Path.resolve
    candidate = repository.storage_root / "session" / "frame.jpg"
    other = repository.storage_root / "other-session" / "other-frame.jpg"

    def redirected(path, *args, **kwargs):
        return other if path == candidate else original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", redirected)
    with pytest.raises(ImageStorageError, match="redirects"):
        repository._safe_path("session/frame.jpg")


def test_write_failure_has_no_database_insert(mocked_repository, image):
    repository, session, _ = mocked_repository
    with patch("pathlib.Path.open", side_effect=PermissionError("private details")):
        with pytest.raises(ImageStorageError):
            save(repository, image)
    session.add.assert_not_called()


def test_flush_failure_rolls_back_and_cleans_file(mocked_repository, image):
    repository, session, _ = mocked_repository
    session.flush.side_effect = SQLAlchemyError("synthetic-password")
    with pytest.raises(RepositoryError) as caught:
        save(repository, image)
    assert "synthetic-password" not in str(caught.value)
    session.rollback.assert_called_once()
    session.commit.assert_not_called()
    assert not list(repository.storage_root.rglob("*.jpg"))


def test_ambiguous_commit_retains_image_for_recovery(mocked_repository, image):
    repository, session, _ = mocked_repository
    session.commit.side_effect = SQLAlchemyError("private details")
    with pytest.raises(StorageConsistencyError, match="uncertain"):
        save(repository, image)
    assert len(list(repository.storage_root.rglob("*.jpg"))) == 1


def test_duplicate_id_never_overwrites(mocked_repository, image):
    repository, session, _ = mocked_repository
    session_id, frame_id = uuid4(), uuid4()
    save(repository, image, session_id=session_id, frame_id=frame_id)
    original = (repository.storage_root / str(session_id) / f"{frame_id}.jpg").read_bytes()
    with pytest.raises(DuplicateFrameError):
        save(repository, 255 - image, session_id=session_id, frame_id=frame_id)
    assert (repository.storage_root / str(session_id) / f"{frame_id}.jpg").read_bytes() == original
    session.add.assert_called_once()


def test_sql_duplicate_failure_cleans_only_candidate_file(mocked_repository, image):
    repository, session, _ = mocked_repository
    session.flush.side_effect = IntegrityError("insert", {}, SimpleNamespace(args=(1062, "synthetic duplicate details")))
    with pytest.raises(DuplicateFrameError):
        save(repository, image)
    assert not list(repository.storage_root.rglob("*.jpg"))


def test_listing_is_parameterized_session_scoped_and_stable(mocked_repository, image):
    repository, session, captured = mocked_repository
    session_id = uuid4()
    identifier = save(repository, image, session_id=session_id)
    session.scalars.return_value = [captured["row"]]
    results = repository.list_frames(session_id, limit=10)
    statement = session.scalars.call_args.args[0]
    sql = str(statement.compile(dialect=mysql.dialect()))
    assert "frames.session_id =" in sql and "ORDER BY frames.captured_at DESC, frames.frame_id DESC" in sql
    assert statement.compile().params["session_id_1"] == session_id
    assert results[0].frame_id == identifier
    cursor = FrameCursor(results[0].captured_at, identifier)
    repository.list_frames(session_id, before=cursor)
    pagination = str(session.scalars.call_args.args[0].compile(dialect=mysql.dialect()))
    assert "frames.captured_at <" in pagination and "frames.frame_id <" in pagination
    assert "frames.captured_at =" in pagination
    session.scalar.return_value = 1
    assert repository.count_frames(session_id) == 1


def test_delete_removes_record_and_image(mocked_repository, image):
    repository, session, captured = mocked_repository
    identifier = save(repository, image)
    path = repository.storage_root / captured["row"].image_path
    session.scalar.return_value = captured["row"]
    assert repository.delete_frame(identifier)
    assert not path.exists() and not list(path.parent.glob("*.jpg"))
    session.delete.assert_called_once_with(captured["row"])


def test_delete_failure_restores_image(mocked_repository, image):
    repository, session, captured = mocked_repository
    identifier = save(repository, image)
    path = repository.storage_root / captured["row"].image_path
    session.scalar.return_value = captured["row"]
    session.flush.side_effect = SQLAlchemyError("private details")
    with pytest.raises(RepositoryError):
        repository.delete_frame(identifier)
    assert path.exists() and not list(path.parent.glob(".*.jpg"))
    session.rollback.assert_called_once()


def test_delete_missing_file_and_missing_record(mocked_repository, image):
    repository, session, captured = mocked_repository
    identifier = save(repository, image)
    (repository.storage_root / captured["row"].image_path).unlink()
    session.scalar.return_value = captured["row"]
    assert repository.delete_frame(identifier)
    session.scalar.return_value = None
    assert repository.delete_frame(uuid4()) is False


def test_partial_file_write_failure_cleans_file(mocked_repository, image):
    repository, session, _ = mocked_repository
    with patch("database.repository.os.fsync", side_effect=OSError("disk error")):
        with pytest.raises(ImageStorageError):
            save(repository, image)
    session.add.assert_not_called()
    assert not list(repository.storage_root.rglob("*.jpg"))


def test_delete_uncertain_commit_retains_quarantine(mocked_repository, image):
    repository, session, captured = mocked_repository
    identifier = save(repository, image)
    session.scalar.return_value = captured["row"]
    session.commit.side_effect = SQLAlchemyError("private details")
    with pytest.raises(StorageConsistencyError, match="uncertain"):
        repository.delete_frame(identifier)
    assert len(list(repository.storage_root.rglob(".*.jpg"))) == 1


def test_post_commit_unlink_failure_is_visible(mocked_repository, image):
    repository, session, captured = mocked_repository
    identifier = save(repository, image)
    session.scalar.return_value = captured["row"]
    with patch("pathlib.Path.unlink", side_effect=OSError("private path")):
        with pytest.raises(StorageConsistencyError, match="committed"):
            repository.delete_frame(identifier)
    assert len(list(repository.storage_root.rglob(".*.jpg"))) == 1


def test_imports_and_database_construction_do_not_connect(tmp_path):
    code = (
        "from unittest.mock import patch\n"
        "from pathlib import Path\n"
        "from sqlalchemy.engine import make_url\n"
        "with patch('pymysql.connect', side_effect=AssertionError('Unexpected connection')) as connect:\n"
        "    import database.models, database.repository\n"
        "    from database.connection import Database, DatabaseSettings\n"
        "    with Database(DatabaseSettings(make_url('mysql+pymysql://u:fake@localhost/db'), Path('.'))):\n"
        "        connect.assert_not_called()\n"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("version, comment", [
    ("8.0.43", "MySQL Community Server - GPL"),
    ("11.4.5-MariaDB", "MariaDB Server"),
    ("8.4.1", "MariaDB"),
])
def test_wrong_server_rejected(version, comment):
    sql_connection = MagicMock()
    sql_connection.scalar.side_effect = [version, comment]
    with pytest.raises(DatabaseConnectionError, match="8.4 LTS"):
        Database._server_version(sql_connection)


def test_mysql_types_preserve_uuid_utc_and_microseconds():
    from database.models import UUIDString, UTCDateTime
    identifier = uuid4()
    uuid_type, date_type = UUIDString(), UTCDateTime()
    assert uuid_type.process_bind_param(identifier, None) == str(identifier)
    assert uuid_type.process_result_value(str(identifier), None) == identifier
    local = datetime(2026, 1, 1, 4, 30, 2, 123456, tzinfo=timezone(timedelta(hours=2)))
    stored = date_type.process_bind_param(local, None)
    assert stored == datetime(2026, 1, 1, 2, 30, 2, 123456)
    assert date_type.process_result_value(stored, None) == local.astimezone(UTC)
    with pytest.raises(ValueError, match="timezone-aware"):
        date_type.process_bind_param(stored, None)


def test_json_vector_preserves_double_precision():
    vector = [1e100] + [1.123456789012345] * 1535
    assert validate_embedding(vector, EMBEDDING_MODEL) == vector


def test_mysql_engine_configuration_stays_lazy_and_uses_utc(tmp_path):
    settings = load_settings(database_url="mysql+pymysql://u:fake@localhost/db", storage_path=tmp_path)
    with patch("database.connection.create_engine") as create:
        connection.create_db_engine(settings)
    kwargs = create.call_args.kwargs
    assert kwargs["hide_parameters"] and not kwargs["echo"]
    assert "time_zone = '+00:00'" in kwargs["connect_args"]["init_command"]
    assert "STRICT_TRANS_TABLES" in kwargs["connect_args"]["init_command"]
    assert settings.url.query["charset"] == "utf8mb4"


def test_schema_has_no_active_postgresql_sql():
    schema = render_schema()
    assert "JSON" in schema and "DATETIME(6)" in schema and "LONGTEXT" in schema
    assert "CREATE TABLE IF NOT EXISTS frames" in schema
    assert "INDEX frames_session_time_idx" in schema
    assert "ascii_bin" in schema and "utf8mb4" in schema
    assert all(word not in schema for word in ("CREATE EXTENSION", "JSONB", "VECTOR(", "TIMESTAMPTZ", "DO $"))
    assert '"minItems": 1536' in schema  # Never accidentally render JSON schema numbers as SQL binds.


def test_existing_incompatible_schema_is_rejected():
    inspector = MagicMock()
    inspector.has_table.return_value = True
    inspector.get_columns.return_value = []
    inspector.get_pk_constraint.return_value = {"constrained_columns": []}
    inspector.get_table_options.return_value = {"mysql_engine": "InnoDB", "mysql_collate": "utf8mb4_0900_ai_ci"}
    with patch("database.connection.inspect", return_value=inspector):
        with pytest.raises(DatabaseConnectionError, match="will not rewrite or drop"):
            Database._validate_schema(MagicMock())


@pytest.fixture
def compatible_schema_inspector():
    from sqlalchemy import CheckConstraint
    from sqlalchemy.types import TypeDecorator
    inspector = MagicMock()
    inspector.has_table.return_value = True
    inspector.get_columns.return_value = [
        {"name": column.name, "nullable": column.nullable,
         "type": (mysql.BIGINT() if column.name in ("source_frame_index", "video_timestamp_ms")
                  else column.type.impl.copy() if isinstance(column.type, TypeDecorator)
                  else column.type.copy())}
        for column in Frame.__table__.columns]
    inspector.get_pk_constraint.return_value = {"constrained_columns": ["frame_id"]}
    inspector.get_unique_constraints.return_value = [{"column_names": ["image_path"]}]
    inspector.get_check_constraints.return_value = [
        {"name": constraint.name} for constraint in Frame.__table__.constraints
        if isinstance(constraint, CheckConstraint)]
    inspector.get_indexes.return_value = [
        {"name": index.name, "column_names": list(index.columns.keys())}
        for index in Frame.__table__.indexes]
    inspector.get_table_options.return_value = {
        "mysql_engine": "InnoDB", "mysql_collate": "utf8mb4_0900_ai_ci"}
    return inspector


def test_compatible_reflected_mysql_schema_is_accepted(compatible_schema_inspector):
    with patch("database.connection.inspect", return_value=compatible_schema_inspector):
        Database._validate_schema(MagicMock())


@pytest.mark.parametrize("drift", ["datetime_precision", "text_charset", "unsigned", "index_columns"])
def test_incompatible_schema_drift_is_rejected(compatible_schema_inspector, drift):
    inspector = compatible_schema_inspector
    columns = {column["name"]: column for column in inspector.get_columns.return_value}
    if drift == "datetime_precision":
        columns["captured_at"]["type"] = mysql.DATETIME(fsp=0)
    elif drift == "text_charset":
        columns["ocr_text"]["type"] = mysql.LONGTEXT(charset="latin1")
    elif drift == "unsigned":
        columns["source_frame_index"]["type"] = mysql.BIGINT(unsigned=True)
    else:
        inspector.get_indexes.return_value[0]["column_names"] = ["caption"]
    with patch("database.connection.inspect", return_value=inspector):
        with pytest.raises(DatabaseConnectionError, match="incompatible"):
            Database._validate_schema(MagicMock())
