"""Explicit opt-in owned MediaMTX/FFmpeg fixtures; AI remains mocked."""

from datetime import UTC, datetime, timedelta
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from uuid import UUID, uuid4

import cv2
from fastapi.testclient import TestClient
import jwt
import numpy as np
import pytest
from sqlalchemy import delete, select

from api.dependencies import get_embedding_service, get_repository
from api.main import create_app
from api.search_service import SearchService
from api.security import ACCESS_COOKIE
from api.settings import ApiSettings
from database.connection import Database
from database.models import Account, Frame, StreamSession
from database.repository import FrameRepository
from processing.live_runner import LiveMultimediaRunner
from processing.live_settings import LiveSettings, StreamSettings
from processing.live_stream import RTSPFrameSource, StreamState
from processing.pipeline import MultimediaPipeline
from processing.pipeline_demo import MockOCR, MockVision, MockEmbedding

pytestmark = pytest.mark.skipif(os.environ.get("RUN_LIVE_TESTS") != "1",
                                reason="Set RUN_LIVE_TESTS=1 for actual MediaMTX/FFmpeg integration")
MYSQL = pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1",
                           reason="Also set RUN_MYSQL_TESTS=1 for live MySQL integration")


def stop_owned(process):
    if process.poll() is None:
        if process.stdin is not None:
            try:
                process.stdin.write(b"q\n")
                process.stdin.flush()
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
    if process.stdin is not None:
        process.stdin.close()


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    media = os.environ.get("MEDIAMTX_EXECUTABLE") or shutil.which("mediamtx")
    ffmpeg = os.environ.get("FFMPEG_EXECUTABLE") or shutil.which("ffmpeg")
    assert media and Path(media).is_file(), "Opt-in live tests require MEDIAMTX_EXECUTABLE or mediamtx on PATH"
    assert ffmpeg and Path(ffmpeg).is_file(), "Opt-in live tests require FFMPEG_EXECUTABLE or ffmpeg on PATH"
    root = tmp_path_factory.mktemp("owned_mediamtx")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = (Path(__file__).resolve().parents[1] / "streaming" / "mediamtx.local.yml").read_text()
    config = root / "mediamtx.yml"
    config.write_text(base.replace("127.0.0.1:8554", f"127.0.0.1:{port}").replace("webrtc: true", "webrtc: false"))
    logs = (root / "server.log").open("wb")
    process = subprocess.Popen([str(media), str(config)], stdout=logs, stderr=logs,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        deadline = time.monotonic() + 5
        while True:
            if process.poll() is not None:
                logs.flush()
                pytest.fail("Owned MediaMTX failed: " + (root / "server.log").read_text(errors="replace"))
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.1):
                    break
            except OSError:
                assert time.monotonic() < deadline, "Owned MediaMTX listener did not start"
                time.sleep(.05)
        yield dict(port=port, ffmpeg=str(ffmpeg), process=process)
    finally:
        stop_owned(process)
        logs.close()
        assert process.poll() is not None


class Publisher:
    def __init__(self, server, session_id):
        self.server, self.session_id = server, session_id
        self.process = None

    def start(self):
        assert self.process is None or self.process.poll() is not None
        command = [self.server["ffmpeg"], "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi",
            "-i", "testsrc2=size=320x240:rate=15", "-an", "-c:v", "libx264", "-threads", "1",
            "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-g", "15",
            "-rtsp_transport", "tcp", "-f", "rtsp", f"rtsp://127.0.0.1:{self.server['port']}/live/{self.session_id}"]
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        time.sleep(.5)
        assert self.process.poll() is None, "Owned synthetic H.264 publisher could not start"

    def stop(self):
        if self.process is not None:
            stop_owned(self.process)


@pytest.fixture
def stream(server):
    sid = uuid4()
    publisher = Publisher(server, sid)
    settings = StreamSettings(f"rtsp://127.0.0.1:{server['port']}/live/SESSION_ID",
        open_timeout_seconds=4, read_timeout_seconds=1, reconnect_initial_seconds=.1,
        reconnect_max_seconds=.3, max_reconnect_attempts=20)
    try:
        publisher.start()
        yield dict(sid=sid, publisher=publisher, settings=settings)
    finally:
        publisher.stop()


def source(stream):
    return RTSPFrameSource(stream["sid"], settings=stream["settings"])


def pipeline(repository=None):
    return MultimediaPipeline(ocr_service=MockOCR(), vision_service=MockVision(),
        embedding_service=MockEmbedding(), repository=repository, mocked=True)


def test_actual_h264_rtsp_decodes_and_releases(stream):
    reader = source(stream)
    frames = reader.frames()
    try:
        values = [next(frames) for _ in range(3)]
        assert all(frame.image.shape == (240, 320, 3) for frame in values)
        assert all(frame.session_id == stream["sid"] for frame in values)
        assert values[-1].sequence > values[0].sequence
        assert values[-1].arrived_at >= values[0].arrived_at
        assert reader.native_timeouts in (True, False)
    finally:
        frames.close()
    assert reader.state == StreamState.STOPPED and reader._capture is None


def test_actual_live_sampling_pipeline_without_mysql(stream):
    runner = LiveMultimediaRunner(stream_source=source(stream), pipeline=pipeline(),
        settings=LiveSettings(duration_seconds=4, max_accepted_frames=2), dry_run=True)
    report = runner.run()
    assert report["state"] == "STOPPED", report
    assert report["decoded_frames"] > report["sampled_frames"] >= 1
    assert report["processing"]["analyzed_frames"] >= 1 and report["processing"]["saved_frames"] == 0
    assert report["processing"]["failed_frames"] == 0
    assert report["queue_depth"] == 0


def test_actual_publisher_stop_restart_same_session(stream):
    reader = source(stream)
    frames = reader.frames()
    restart_errors = []
    thread = None
    try:
        first = next(frames)
        stream["publisher"].stop()
        def restart():
            try:
                time.sleep(1.5)
                stream["publisher"].start()
            except Exception as error:
                restart_errors.append(error)
        thread = threading.Thread(target=restart)
        thread.start()
        deadline = time.monotonic() + 12
        while True:
            current = next(frames)
            assert time.monotonic() < deadline
            if current.segment > first.segment:
                break
        assert current.session_id == first.session_id and current.sequence > first.sequence
        assert current.arrived_at > first.arrived_at and reader.successful_reconnections >= 1
    finally:
        frames.close()
        if thread is not None:
            thread.join(5)
    assert not restart_errors


def test_actual_acquisition_continues_while_ai_is_slow_queue_bounded(stream):
    processing = pipeline()
    original = processing.ocr.extract_text
    first = True
    def slow(image):
        nonlocal first
        if first:
            first = False
            time.sleep(3.2)
        return original(image)
    processing.ocr.extract_text = slow
    runner = LiveMultimediaRunner(stream_source=source(stream), pipeline=processing,
        settings=LiveSettings(duration_seconds=6, queue_size=1, max_accepted_frames=3), dry_run=True)
    report = runner.run()
    assert report["state"] == "STOPPED", report
    assert report["queue_dropped_frames"] > 0 and report["queue_capacity"] == 1 and report["queue_depth"] == 0
    assert report["decoded_frames"] > 30
    assert report["sampled_frames"] == (report["frames_sent_to_analysis"] + report["queue_dropped_frames"] +
        report["shutdown_dropped_frames"] + report["stale_dropped_frames"])


@pytest.fixture
def stored(stream, tmp_path):
    with Database() as database:
        database.check()
        repository = FrameRepository(database.sessions, tmp_path / "live_jpegs")
        user, other_sid = uuid4(), uuid4()
        now = datetime.now(UTC)
        with database.sessions.begin() as session:
            session.add(Account(user_id=user, email=f"live-{user.hex}@example.invalid", name="Synthetic live test", password_hash="not-a-real-login"))
            session.flush()
            session.add_all([StreamSession(session_id=stream["sid"], user_id=user, started_at=now, status="ended"),
                             StreamSession(session_id=other_sid, user_id=user, started_at=now, status="ended")])
        try:
            yield dict(database=database, repository=repository, user=user, other_sid=other_sid)
        finally:
            with database.sessions() as session:
                ids = session.scalars(select(Frame.frame_id).where(Frame.session_id == stream["sid"])).all()
            for identifier in ids:
                repository.delete_frame(identifier)
            with database.sessions.begin() as session:
                session.execute(delete(StreamSession).where(StreamSession.session_id.in_([stream["sid"], other_sid])))
                session.execute(delete(Account).where(Account.user_id == user))


@MYSQL
def test_actual_live_mysql_jpeg_search_http_and_session_isolation(stream, stored):
    runner = LiveMultimediaRunner(stream_source=source(stream), pipeline=pipeline(stored["repository"]),
        settings=LiveSettings(duration_seconds=5, max_accepted_frames=2), dry_run=False)
    report = runner.run()
    assert report["state"] == "STOPPED" and report["processing"]["saved_frames"] >= 1, report
    ids = report["processing"]["frame_ids"]
    assert len(ids) == len(set(ids))
    rows = stored["repository"].list_frames(stream["sid"])
    assert len(rows) == len(ids)
    for row in rows:
        assert row.video_timestamp_ms is None and row.source_frame_index > 0
        assert len(row.embedding) == 1536 and row.embedding_model == "text-embedding-3-small"
        assert (row.expires_at - row.created_at).total_seconds() == pytest.approx(86400, abs=.01)
        assert cv2.imdecode(np.frombuffer(stored["repository"].load_frame_image(row.frame_id), dtype=np.uint8), cv2.IMREAD_COLOR).shape == (240, 320, 3)
    assert stored["repository"].list_frames(stored["other_sid"]) == []
    search = SearchService(stored["repository"], MockEmbedding())
    assert search.search(stream["sid"], "synthetic sign", "history", 5)["frames"]
    secret = uuid4().hex + uuid4().hex
    app = create_app(ApiSettings(jwt_secret=secret))
    app.dependency_overrides[get_repository] = lambda: stored["repository"]
    app.dependency_overrides[get_embedding_service] = lambda: MockEmbedding()
    token = jwt.encode({"sub": str(stored["user"]), "typ": "access", "exp": datetime.now(UTC) + timedelta(minutes=5)}, secret, algorithm="HS256")
    with TestClient(app) as client:
        client.cookies.set(ACCESS_COOKIE, token)
        timeline = client.get("/api/v1/frames", params={"session_id": str(stream["sid"])}).json()
        assert len(timeline["frames"]) == len(ids)
        assert client.get(timeline["frames"][0]["image_url"]).status_code == 200
        assert client.post("/api/v1/search", json={"session_id": str(stream["sid"]), "query": "synthetic sign", "mode": "history", "limit": 5}).json()["frames"]


@MYSQL
def test_actual_reconnect_then_persist_fresh_frames_without_retrying_analysis(stream, stored):
    reader = source(stream)
    frames = reader.frames()
    processing = pipeline(stored["repository"])
    thread = None
    try:
        first = next(frames)
        a = processing.process_live_frame(first.image, first.session_id, captured_at=first.arrived_at,
            source_frame_index=first.sequence, elapsed_ms=0)
        assert a.status == "saved"
        stream["publisher"].stop()
        def restart():
            time.sleep(1.5)
            stream["publisher"].start()
        thread = threading.Thread(target=restart)
        thread.start()
        deadline = time.monotonic() + 20
        while True:
            last = next(frames)
            assert time.monotonic() < deadline
            if last.segment > first.segment and last.monotonic_time - first.monotonic_time >= 10:
                break
        # Preserve the selector and wait for a genuine monotonic coverage gap.
        b = processing.process_live_frame(last.image, last.session_id, captured_at=last.arrived_at,
            source_frame_index=last.sequence, elapsed_ms=(last.monotonic_time - first.monotonic_time) * 1000)
        assert b.status == "saved" and a.frame_id != b.frame_id
        assert stored["repository"].count_frames(stream["sid"]) == 2
        assert stored["repository"].get_frame(b.frame_id).captured_at > stored["repository"].get_frame(a.frame_id).captured_at
    finally:
        frames.close()
        if thread is not None:
            thread.join(5)
