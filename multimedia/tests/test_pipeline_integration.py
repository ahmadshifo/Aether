"""Opt-in actual MySQL + OpenCV + private JPEG + HTTP, with synthetic AI only."""

from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID, uuid4

import cv2
from fastapi.testclient import TestClient
import jwt
import numpy as np
import pytest
from sqlalchemy import delete, select, update, text

from api.dependencies import get_embedding_service, get_repository
from api.main import create_app
from api.search_service import SearchService
from api.security import ACCESS_COOKIE
from api.settings import ApiSettings
from database.connection import Database
from database.errors import ImageStorageError, RepositoryError
from database.models import Account, Frame, StreamSession
from database.repository import FrameRepository
from database.retention import cleanup_expired_frames
from processing.pipeline import MultimediaPipeline, PipelineSettings
from processing.pipeline_demo import MockEmbedding, MockOCR, MockVision, write_demo_video

pytestmark = pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1",
                                reason="Set RUN_MYSQL_TESTS=1 for actual MySQL pipeline/retention integration")


@pytest.fixture(scope="module")
def database():
    with Database() as database:
        database.check()  # Never create/drop/reset tables in these tests.
        yield database


@pytest.fixture
def stored(database, tmp_path):
    repository = FrameRepository(database.sessions, tmp_path / "private_jpegs")
    now = datetime.now(UTC)
    sid, other_sid, user = uuid4(), uuid4(), uuid4()
    with database.sessions.begin() as session:
        session.add(Account(user_id=user, email=f"pipeline-{user.hex}@example.invalid",
                            name="Synthetic pipeline test", password_hash="not-a-login-password"))
        session.flush()
        session.add_all([StreamSession(session_id=sid, user_id=user, started_at=now, status="ended"),
                         StreamSession(session_id=other_sid, user_id=user, started_at=now, status="ended")])
    video = write_demo_video(tmp_path / "scenes.avi")
    pipeline = MultimediaPipeline(ocr_service=MockOCR(), vision_service=MockVision(),
        embedding_service=MockEmbedding(), repository=repository, mocked=True)
    result = pipeline.process_video(video, sid, recording_start=now - timedelta(seconds=10))
    try:
        assert result.saved_frames == 2 and not result.fatal_error
        yield dict(database=database, repository=repository, sid=sid, other_sid=other_sid,
                   user=user, now=now, pipeline=pipeline, result=result, video=video)
    finally:
        # Only these unique sessions' frames, including any frame saved before
        # a deliberately failed report. Never run global destructive cleanup.
        with database.sessions() as session:
            ids = session.scalars(select(Frame.frame_id).where(Frame.session_id.in_([sid, other_sid]))).all()
        for identifier in ids:
            repository.delete_frame(identifier)
        with database.sessions.begin() as session:
            session.execute(delete(StreamSession).where(StreamSession.session_id.in_([sid, other_sid])))
            session.execute(delete(Account).where(Account.user_id == user))


def expire(stored, identifier=None):
    identifier = UUID(stored["result"].frame_ids[0]) if identifier is None else identifier
    now = stored["now"]
    with stored["database"].sessions.begin() as session:
        session.execute(update(Frame).where(Frame.frame_id == identifier).values(
            created_at=now - timedelta(hours=25), expires_at=now - timedelta(hours=1)))
    return identifier


def cleanup(stored, **kwargs):
    return cleanup_expired_frames(stored["repository"], stored["now"], session_id=stored["sid"], **kwargs)


def test_pipeline_actual_mysql_stats_and_schema(stored):
    assert stored["database"].check()["mysql_version"].startswith(("8.0.", "8.4."))
    result = stored["result"]
    assert result.sampled_frames == 4 and result.total_decoded_frames == 40
    assert result.selected_frames == result.saved_frames == 2 and result.rejected_frames == 2
    assert result.failed_frames == 0 and result.rejection_reasons == {"duplicate": 1, "blurry": 1}


def test_actual_metadata_positions_and_unicode(stored):
    rows = stored["repository"].list_frames(stored["sid"])
    assert [row.source_frame_index for row in rows] == [30, 0]
    assert [row.video_timestamp_ms for row in rows] == [3000, 0]
    for row in rows:
        assert row.session_id == stored["sid"]
        assert row.ocr_text == "MOCK ROOM 205\nغرفة ٢٠٥"
        assert row.objects == ["synthetic sign"]
        assert row.caption.startswith("MOCK scene")
        assert row.embedding_model == "text-embedding-3-small" and len(row.embedding) == 1536
        assert (row.expires_at - row.created_at).total_seconds() == pytest.approx(86400, abs=.01)
        assert row.created_at > row.captured_at


def test_jpegs_retrievable_and_json_native(stored):
    for identifier in stored["result"].frame_ids:
        data = stored["repository"].load_frame_image(identifier)
        assert cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR).shape == (96, 128, 3)
        row = stored["repository"].get_frame(identifier)
        assert (stored["repository"].storage_root / row.image_path).is_file()
        with stored["database"].engine.connect() as connection:
            value = connection.execute(text("SELECT JSON_TYPE(embedding), JSON_LENGTH(embedding) FROM frames WHERE frame_id=:id"), {"id": identifier}).one()
            assert tuple(value) == ("ARRAY", 1536)


def test_session_separation(stored):
    assert stored["repository"].list_frames(stored["other_sid"]) == []
    assert stored["repository"].count_frames(stored["sid"]) == 2


def test_persistence_across_new_connection(stored):
    # A separately-created pool, not the original SQLAlchemy identity map.
    with Database(stored["database"].settings) as fresh:
        repository = FrameRepository(fresh.sessions, stored["repository"].storage_root)
        assert repository.count_frames(stored["sid"]) == 2
        assert repository.load_frame_image(stored["result"].frame_ids[0])


def test_retention_dry_run_then_execute_preserves_active(stored):
    identifier = expire(stored)
    expired = stored["repository"].get_frame(identifier)
    path = stored["repository"].storage_root / expired.image_path
    report = cleanup(stored, dry_run=True, batch_size=1)
    assert report.expired_records_found == 1 and report.records_deleted == 0 and not report.failures
    assert path.exists() and stored["repository"].get_frame(identifier)
    report = cleanup(stored, dry_run=False, batch_size=1)
    assert report.records_deleted == report.files_deleted == 1 and report.failures == 0
    assert not path.exists() and stored["repository"].get_frame(identifier) is None
    assert stored["repository"].count_frames(stored["sid"]) == 1
    assert cleanup(stored, dry_run=False).records_deleted == 0


def test_retention_multiple_batches_equal_expiry(stored):
    for identifier in stored["result"].frame_ids:
        expire(stored, UUID(identifier))
    report = cleanup(stored, dry_run=False, batch_size=1)
    assert report.records_deleted == report.files_deleted == 2 and report.failures == 0
    assert stored["repository"].count_frames(stored["sid"]) == 0


def test_missing_jpeg_recovery(stored):
    identifier = expire(stored)
    row = stored["repository"].get_frame(identifier)
    (stored["repository"].storage_root / row.image_path).unlink()
    report = cleanup(stored, dry_run=False)
    assert report.records_deleted == report.missing_files == 1 and report.files_deleted == 0 and not report.failures


def test_task11_excludes_expired_before_cleanup(stored):
    identifier = expire(stored)
    service = SearchService(stored["repository"], MockEmbedding(), clock=lambda: stored["now"])
    results = service.search(stored["sid"], "synthetic sign", "history", 5)["frames"]
    assert len(results) == 1 and results[0]["frame_id"] != str(identifier)
    assert stored["repository"].get_frame(identifier) is not None


def test_task12_expiry_images_timeline_search_and_required_limit(stored):
    identifier = expire(stored)
    secret = uuid4().hex + uuid4().hex
    app = create_app(ApiSettings(jwt_secret=secret), clock=lambda: stored["now"])
    app.dependency_overrides[get_repository] = lambda: stored["repository"]
    app.dependency_overrides[get_embedding_service] = lambda: MockEmbedding()
    token = jwt.encode({"sub": str(stored["user"]), "typ": "access",
                        "exp": datetime.now(UTC) + timedelta(minutes=5)}, secret, algorithm="HS256")
    with TestClient(app) as client:
        client.cookies.set(ACCESS_COOKIE, token)
        assert client.get("/health").status_code == 200
        frames = client.get("/api/v1/frames", params={"session_id": str(stored["sid"])}).json()["frames"]
        assert len(frames) == 1 and frames[0]["frame_id"] != str(identifier)
        assert client.get(f"/api/v1/frames/{identifier}/image").status_code == 404
        assert client.get(frames[0]["image_url"]).status_code == 200
        body = {"session_id": str(stored["sid"]), "query": "synthetic sign", "mode": "history", "limit": 5}
        results = client.post("/api/v1/search", json=body).json()["frames"]
        assert len(results) == 1 and results[0]["timestamp"] == results[0]["captured_at"]
        body.pop("limit")
        assert client.post("/api/v1/search", json=body).status_code == 422


def test_actual_named_lock_coordinates_separate_pools(stored):
    expire(stored)
    with Database(stored["database"].settings) as other:
        other_repo = FrameRepository(other.sessions, stored["repository"].storage_root)
        with stored["repository"].retention_lock():
            report = cleanup_expired_frames(other_repo, stored["now"], dry_run=False, session_id=stored["sid"])
            assert report.stopped and report.failures == 1 and report.records_deleted == 0
        report = cleanup_expired_frames(other_repo, stored["now"], dry_run=False, session_id=stored["sid"])
        assert report.records_deleted == 1 and report.failures == 0


def test_expiry_edit_rechecked_under_actual_row_lock(stored):
    identifier = expire(stored)
    candidate = next(stored["repository"].iter_expired_frames(stored["now"], session_id=stored["sid"]))
    with stored["database"].sessions.begin() as session:
        session.execute(update(Frame).where(Frame.frame_id == identifier).values(expires_at=stored["now"] + timedelta(hours=1)))
    outcome = stored["repository"].delete_expired_frame(candidate.frame_id, stored["now"])
    assert not outcome.deleted and stored["repository"].load_frame_image(identifier)


def test_scoped_cleanup_cannot_delete_other_session(stored):
    image = np.full((16, 16, 3), 128, dtype=np.uint8)
    identifier = stored["repository"].save_frame(stored["other_sid"], stored["now"], image)
    expire(stored, identifier)
    assert cleanup(stored, dry_run=False).records_deleted == 0
    assert stored["repository"].get_frame(identifier) is not None


def test_actual_rollback_after_mysql_flush_failure(stored, monkeypatch):
    identifier = expire(stored)
    from sqlalchemy.exc import SQLAlchemyError
    from sqlalchemy.orm import Session
    with monkeypatch.context() as patcher:
        patcher.setattr(Session, "flush", Mock(side_effect=SQLAlchemyError("synthetic failure")))
        report = cleanup(stored, dry_run=False)
    assert report.failures == 1 and report.records_deleted == 0
    assert stored["repository"].get_frame(identifier) is not None
    assert stored["repository"].load_frame_image(identifier)
    assert not list(stored["repository"].storage_root.rglob(".*.jpg"))


def test_pipeline_analysis_failure_saves_no_partial_row(stored):
    pipeline = stored["pipeline"]
    pipeline.ocr = Mock(extract_text=Mock(side_effect=RuntimeError("test-controlled OCR failure")))
    before = stored["repository"].count_frames(stored["sid"])
    result = pipeline.process_video(stored["video"], stored["sid"], recording_start=stored["now"])
    assert result.failed_frames == 2 and result.saved_frames == 0
    assert stored["repository"].count_frames(stored["sid"]) == before


def test_controlled_manual_retention_fixture(database, tmp_path):
    from scripts.demo_retention import inspect_fixture, seed
    repository = FrameRepository(database.sessions, tmp_path / "fixture_images")
    fixture = seed(database, repository)
    sid, ids, _ = inspect_fixture(repository, fixture["session_id"], fixture["expired_frame_id"], fixture["retained_frame_id"])
    try:
        preview = cleanup_expired_frames(repository, dry_run=True, session_id=sid)
        assert preview.expired_records_found == 1 and preview.records_deleted == 0
        report = cleanup_expired_frames(repository, dry_run=False, session_id=sid)
        assert report.records_deleted == report.files_deleted == 1 and not report.failures
        _, _, rows = inspect_fixture(repository, sid, *ids)
        assert rows[0] is None and rows[1] is not None
        with pytest.raises(ValueError):
            inspect_fixture(repository, uuid4(), *ids)
    finally:
        for identifier in ids:
            repository.delete_frame(identifier)
