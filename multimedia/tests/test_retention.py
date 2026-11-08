"""Offline cleanup tests: temporary JPEGs and mocked SQL, never real data."""

from contextlib import contextmanager, nullcontext
from datetime import UTC, datetime, timedelta, timezone
import json
from pathlib import Path
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.dialects import mysql

from database.errors import ImageStorageError, RepositoryError, StorageConsistencyError
from database.repository import ExpiredFrame, FrameDeletion, FrameRepository
from database.retention import RetentionSettings, cleanup_expired_frames, main, run_worker

NOW = datetime(2026, 11, 7, tzinfo=UTC)


@pytest.fixture(autouse=True)
def no_database():
    with patch("pymysql.connect", side_effect=AssertionError("No MySQL")):
        yield


@pytest.fixture
def fake():
    repository = Mock()
    repository.retention_lock.side_effect = nullcontext
    repository.iter_expired_frames.return_value = iter(())
    repository.delete_expired_frame.return_value = FrameDeletion(True, 1)
    return repository


def candidates(fake, offsets):
    records = [ExpiredFrame(uuid4(), NOW + timedelta(seconds=offset)) for offset in offsets]
    fake.iter_expired_frames.return_value = iter(records)
    return records


def test_dry_run_default_counts_only_eligible(fake):
    candidates(fake, [-1, 0, 1])
    report = cleanup_expired_frames(fake, NOW)
    assert report.expired_records_found == 2 and report.skipped_records == 1
    assert report.records_deleted == report.files_deleted == report.failures == 0
    fake.delete_expired_frame.assert_not_called()


def test_explicit_execute_counts_files_and_rows(fake):
    rows = candidates(fake, [-3, -2, 0])
    report = cleanup_expired_frames(fake, NOW, batch_size=2, dry_run=False)
    assert report.records_deleted == report.files_deleted == report.expired_records_found == 3
    assert report.failures == 0
    fake.iter_expired_frames.assert_called_once_with(NOW, batch_size=2, session_id=None)
    assert [c.args[0] for c in fake.delete_expired_frame.call_args_list] == [r.frame_id for r in rows]


def test_utc_boundary_and_other_timezones(fake):
    fake.iter_expired_frames.return_value = iter([ExpiredFrame(uuid4(), NOW.astimezone(timezone(timedelta(hours=3))))])
    assert cleanup_expired_frames(fake, NOW, dry_run=False).records_deleted == 1


def test_invalid_missing_expiry_stops_without_delete(fake):
    fake.iter_expired_frames.return_value = iter([ExpiredFrame(uuid4(), None)])
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.failures == 1 and report.stopped and report.records_deleted == 0


def test_missing_file_explicit_recovery(fake):
    candidates(fake, [-1])
    fake.delete_expired_frame.return_value = FrameDeletion(True, 0, True)
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.records_deleted == report.missing_files == 1 and report.files_deleted == 0


def test_racing_delete_or_extended_expiry_is_skipped(fake):
    candidates(fake, [-1])
    fake.delete_expired_frame.return_value = FrameDeletion(False)
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.skipped_records == 1 and report.records_deleted == 0


@pytest.mark.parametrize("error", [RepositoryError("private DSN"), ImageStorageError("private path")])
def test_individual_failure_advances_not_infinite_loop(fake, error):
    candidates(fake, [-2, -1])
    fake.delete_expired_frame.side_effect = [error, FrameDeletion(True, 1)]
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.failures == report.records_deleted == 1 and not report.stopped
    assert "private" not in json.dumps(report.to_dict())


def test_uncertain_outcome_stops_and_does_not_claim_success(fake):
    candidates(fake, [-2, -1])
    fake.delete_expired_frame.side_effect = StorageConsistencyError("private recovery details")
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.stopped and report.failures == 1 and report.records_deleted == report.files_deleted == 0
    assert fake.delete_expired_frame.call_count == 1


def test_query_failure_safe_report(fake):
    fake.iter_expired_frames.side_effect = RepositoryError("password")
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.stopped and report.failures == 1 and report.records_deleted == 0


def test_error_details_memory_bounded(fake):
    candidates(fake, [-1] * 120)
    fake.delete_expired_frame.side_effect = RepositoryError("private")
    report = cleanup_expired_frames(fake, NOW, dry_run=False)
    assert report.failures == 120 and len(report.errors) == 100


def test_empty_and_repeatable(fake):
    for _ in range(2):
        fake.iter_expired_frames.return_value = iter(())
        report = cleanup_expired_frames(fake, NOW, dry_run=False)
        assert report.expired_records_found == report.records_deleted == report.failures == 0


@pytest.mark.parametrize("batch", [0, -1, True, 1.5, 1001])
def test_invalid_batch_rejected(fake, batch):
    with pytest.raises(ValueError):
        cleanup_expired_frames(fake, NOW, batch_size=batch)


@pytest.mark.parametrize("interval", [0, -1, True, float("nan"), float("inf"), 10081])
def test_invalid_worker_interval(interval):
    with pytest.raises(ValueError):
        RetentionSettings(interval_minutes=interval)


def test_naive_now_rejected(fake):
    with pytest.raises(ValueError):
        cleanup_expired_frames(fake, NOW.replace(tzinfo=None))


def test_session_scope_optional_global_default(fake):
    sid = uuid4()
    cleanup_expired_frames(fake, NOW, session_id=sid)
    assert fake.iter_expired_frames.call_args.kwargs["session_id"] == sid


def test_worker_graceful_interrupt_and_report(fake):
    stop = threading.Event()
    stop.wait = Mock(side_effect=KeyboardInterrupt)
    emit = Mock()
    assert run_worker(fake, RetentionSettings(), stop_event=stop, emit=emit, clock=lambda: NOW) == 0
    assert stop.is_set() and emit.call_count == 1
    stop.wait.assert_called_once_with(900)
    assert json.loads(emit.call_args.args[0])["dry_run"] is True


def test_worker_lock_contention_stops(fake):
    fake.retention_lock.side_effect = RepositoryError("Another worker")
    assert run_worker(fake, RetentionSettings(), emit=Mock()) == 1
    fake.delete_expired_frame.assert_not_called()


def test_worker_stops_when_event_set(fake):
    stop = threading.Event()
    stop.set()
    assert run_worker(fake, RetentionSettings(), stop_event=stop) == 0
    fake.retention_lock.assert_not_called()


@pytest.fixture
def repo(tmp_path):
    session = MagicMock()
    session.__enter__.return_value = session
    factory = MagicMock(return_value=session)
    repository = FrameRepository(factory, tmp_path / "managed")
    identifier, sid = uuid4(), uuid4()
    row = SimpleNamespace(frame_id=identifier, session_id=sid, expires_at=NOW,
                          image_path=f"{sid}/{identifier}.jpg")
    session.scalar.return_value = row
    path = repository.storage_root / row.image_path
    path.parent.mkdir(parents=True)
    path.write_bytes(b"temporary JPEG fixture")
    return repository, session, row, path


def test_actual_safe_delete_removes_only_associated_file(repo):
    repository, session, row, path = repo
    unrelated = path.parent / "unrelated.jpg"
    unrelated.write_bytes(b"untouched")
    result = repository.delete_expired_frame(row.frame_id, NOW)
    assert result == FrameDeletion(True, 1, False)
    assert not path.exists() and unrelated.read_bytes() == b"untouched"
    session.commit.assert_called_once()
    query = str(session.scalar.call_args.args[0].compile(dialect=mysql.dialect()))
    assert "FOR UPDATE" in query


def test_actual_delete_rechecks_expiry_under_lock(repo):
    repository, session, row, path = repo
    row.expires_at = NOW + timedelta(seconds=1)
    assert repository.delete_expired_frame(row.frame_id, NOW) == FrameDeletion(False)
    session.delete.assert_not_called()
    assert path.exists()


def test_actual_missing_jpeg_deletes_expired_metadata(repo):
    repository, _, row, path = repo
    path.unlink()
    assert repository.delete_expired_frame(row.frame_id, NOW) == FrameDeletion(True, 0, True)


@pytest.mark.parametrize("unsafe", ["../outside.jpg", "C:/outside.jpg", "wrong/uuid.jpg"])
def test_traversal_never_touches_external_file(repo, unsafe):
    repository, session, row, path = repo
    row.image_path = unsafe
    with pytest.raises(ImageStorageError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert path.exists()
    session.delete.assert_not_called()


def test_symlink_escape_rejected(repo, tmp_path):
    repository, _, row, path = repo
    external = tmp_path / "external.jpg"
    external.write_bytes(b"do not delete")
    path.unlink()
    try:
        path.symlink_to(external)
    except OSError:
        pytest.skip("Windows symlink privilege unavailable")
    with pytest.raises(ImageStorageError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert external.read_bytes() == b"do not delete"


def test_resolved_redirect_rejected_without_symlink_privilege(repo):
    repository, session, row, path = repo
    with patch.object(Path, "resolve", return_value=repository.storage_root.parent / "outside.jpg"), pytest.raises(ImageStorageError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert path.exists()
    session.delete.assert_not_called()


def test_flush_failure_restores_quarantined_jpeg(repo):
    repository, session, row, path = repo
    session.flush.side_effect = SQLAlchemyError("private")
    with pytest.raises(RepositoryError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert path.exists() and not list(path.parent.glob(".*.jpg"))
    session.rollback.assert_called_once()


@pytest.mark.parametrize("when", ["commit", "unlink"])
def test_uncertain_or_committed_failure_retains_recovery_file(repo, when):
    repository, session, row, path = repo
    if when == "commit":
        session.commit.side_effect = SQLAlchemyError("private")
        context = nullcontext()
    else:
        context = patch.object(Path, "unlink", side_effect=OSError("private"))
    with context, pytest.raises(StorageConsistencyError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert len(list(path.parent.glob(".*.jpg"))) == 1


def test_file_rename_failure_rolls_back_without_deleting(repo):
    repository, session, row, path = repo
    with patch.object(Path, "rename", side_effect=OSError("private")), pytest.raises(RepositoryError):
        repository.delete_expired_frame(row.frame_id, NOW)
    assert path.exists()
    session.delete.assert_not_called()


def test_keyset_batches_and_projection(repo):
    repository, session, _, _ = repo
    ids = sorted([uuid4() for _ in range(3)])
    session.execute.side_effect = [Mock(all=Mock(return_value=[(ids[0], NOW), (ids[1], NOW)])),
                                   Mock(all=Mock(return_value=[(ids[2], NOW)])), Mock(all=Mock(return_value=[]))]
    assert [r.frame_id for r in repository.iter_expired_frames(NOW, batch_size=2)] == ids
    queries = [str(c.args[0].compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True})) for c in session.execute.call_args_list]
    assert all("LIMIT 2" in q and "expires_at <=" in q for q in queries)
    assert "frame_id >" in queries[1] and "ORDER BY frames.expires_at, frames.frame_id" in queries[1]
    assert "embedding" not in queries[0] and "image_path" not in queries[0]


def test_mysql_advisory_lock_released_before_connection_close(repo):
    repository = repo[0]
    connection = MagicMock()
    connection.scalar.side_effect = ["test_database", 1, 1]
    repository.sessions.kw = {"bind": Mock(connect=Mock(return_value=connection))}
    with repository.retention_lock():
        pass
    assert "RELEASE_LOCK" in str(connection.scalar.call_args.args[0])
    connection.close.assert_called_once()
    connection.invalidate.assert_not_called()


def test_second_worker_cannot_acquire_lock(repo):
    repository = repo[0]
    connection = MagicMock()
    connection.scalar.side_effect = ["test_database", 0]
    repository.sessions.kw = {"bind": Mock(connect=Mock(return_value=connection))}
    with pytest.raises(RepositoryError, match="Another"):
        with repository.retention_lock():
            pytest.fail("Lock contention must not enter cleanup")
    connection.close.assert_called_once()


def test_failed_lock_release_invalidates_connection(repo):
    repository = repo[0]
    connection = MagicMock()
    connection.scalar.side_effect = ["test_database", 1, SQLAlchemyError("private")]
    repository.sessions.kw = {"bind": Mock(connect=Mock(return_value=connection))}
    with repository.retention_lock():
        pass
    connection.invalidate.assert_called_once()


def test_cli_default_preview_and_explicit_execute(fake, capsys):
    database = Mock()
    database.__enter__ = Mock(return_value=database)
    database.__exit__ = Mock(return_value=False)
    with patch("database.connection.Database", return_value=database), patch("database.repository.FrameRepository.from_database", return_value=fake):
        assert main(["--once"]) == 0
        assert json.loads(capsys.readouterr().out)["dry_run"] is True
        candidates(fake, [-1])
        assert main(["--once", "--execute"]) == 0
        assert json.loads(capsys.readouterr().out)["records_deleted"] == 1


@pytest.mark.parametrize("args", [[], ["--once", "--worker"], ["--once", "--execute", "--dry-run"]])
def test_cli_argument_validation(args):
    with pytest.raises(SystemExit) as error:
        main(args)
    assert error.value.code == 2


def test_settings_env_precedence(monkeypatch):
    monkeypatch.setenv("RETENTION_BATCH_SIZE", "7")
    monkeypatch.setenv("RETENTION_CLEANUP_INTERVAL_MINUTES", "0.5")
    assert RetentionSettings.from_env() == RetentionSettings(7, .5)
