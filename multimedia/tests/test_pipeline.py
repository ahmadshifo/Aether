"""Offline live-ingestion tests: fake RTSP capture, fake AI services, fake repository. No network."""

import io
import json
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import cv2
import numpy as np
import pytest

from processing import pipeline
from processing.frame_extractor import ExtractedFrame
from processing.frame_memory import FrameMemory
from processing.pipeline import FrameAnalyzer, SessionIngest, StreamWatcher, live_sessions
from processing.video_source import RTSPFrameSource, rtsp_url_for


def scene(seed):
    rng = np.random.default_rng(seed)
    image = rng.integers(0, 255, (18, 24, 3), dtype=np.uint8)
    return cv2.resize(image, (96, 72), interpolation=cv2.INTER_NEAREST)


class FakeCapture:
    def __init__(self, images, delay=0.0):
        self.images, self.delay, self.released = list(images), delay, False

    def isOpened(self):
        return True

    def read(self):
        if self.delay:
            time.sleep(self.delay)
        return (True, self.images.pop(0)) if self.images else (False, None)

    def release(self):
        self.released = True


class FakeRepository:
    def __init__(self):
        self.saved = []

    def save_frame(self, session_id, captured_at, image, ocr_text, objects, caption, embedding, model, **kwargs):
        self.saved.append(SimpleNamespace(session_id=session_id, captured_at=captured_at, ocr_text=ocr_text,
                                          objects=objects, caption=caption, embedding=embedding, model=model, **kwargs))
        return uuid4()


class Services:
    def __init__(self, fail=()):
        self.fail = set(fail)

    def extract_text(self, image):
        if "ocr" in self.fail:
            raise RuntimeError("synthetic outage")
        return SimpleNamespace(text="ROOM 205")

    def analyze_image(self, image):
        if "vision" in self.fail:
            raise RuntimeError("synthetic outage")
        return SimpleNamespace(objects=["door", "sign"], caption="A door with a room sign.")

    def embed_frame(self, ocr_text, objects, caption):
        return SimpleNamespace(embedding=[0.1] * 1536, model="text-embedding-3-small")


def live_frame(image, index=0, ms=0.0):
    return ExtractedFrame("rtsp://test", index, ms, image, datetime.now(UTC).isoformat())


def test_rtsp_url_uses_contract_template(monkeypatch):
    session = uuid4()
    monkeypatch.setenv("RTSP_STREAM_URL", "rtsp://media.local:8554/live/SESSION_ID")
    assert rtsp_url_for(session) == f"rtsp://media.local:8554/live/{session}"
    with pytest.raises(ValueError):
        rtsp_url_for("not-a-uuid")


def test_rtsp_source_samples_by_wall_clock_and_ends_when_stream_stops():
    source = RTSPFrameSource("rtsp://test", interval=0.05, max_failed_reads=2,
                             capture_factory=lambda url: FakeCapture([scene(1)] * 30, delay=0.01))
    with source:
        frames = list(source.frames())
    assert source.frames_read == 30
    assert 3 <= len(frames) < 30
    assert all(f.captured_at.endswith("Z") for f in frames)
    assert [f.timestamp_ms for f in frames] == sorted(f.timestamp_ms for f in frames)


def test_rtsp_source_reports_unopened_stream():
    closed = SimpleNamespace(isOpened=lambda: False, release=lambda: None)
    with pytest.raises(ConnectionError):
        with RTSPFrameSource("rtsp://test", capture_factory=lambda url: closed):
            pass


def test_analyzer_stores_all_metadata():
    repository, services = FakeRepository(), Services()
    session = uuid4()
    FrameAnalyzer(repository, services, services, services).analyze_and_save(session, live_frame(scene(1), 7, 1500.0))
    row = repository.saved[0]
    assert (row.session_id, row.ocr_text, row.objects, row.caption) == (session, "ROOM 205", ["door", "sign"], "A door with a room sign.")
    assert row.model == "text-embedding-3-small" and len(row.embedding) == 1536
    assert (row.source_frame_index, row.video_timestamp_ms) == (7, 1500.0)


def test_failed_service_leaves_field_empty_instead_of_losing_frame():
    repository, services = FakeRepository(), Services(fail={"vision"})
    FrameAnalyzer(repository, services, services, services).analyze_and_save(uuid4(), live_frame(scene(1)))
    row = repository.saved[0]
    assert row.ocr_text == "ROOM 205" and row.objects == [] and row.caption == ""


def test_analysis_can_be_switched_off():
    repository = FakeRepository()
    FrameAnalyzer(repository).analyze_and_save(uuid4(), live_frame(scene(1)))
    row = repository.saved[0]
    assert (row.ocr_text, row.objects, row.caption, row.embedding) == ("", [], "", None)


class ListSource:
    def __init__(self, frames):
        self._frames, self.stopped = frames, False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def stop(self):
        self.stopped = True

    def frames(self):
        for frame in self._frames:
            if self.stopped:
                return
            yield frame


def test_session_ingest_remembers_new_scenes_in_ram_only():
    first, second = scene(1), scene(2)
    frames = [live_frame(img, i, i * 1000.0) for i, img in enumerate([first, first, first, second, second])]
    memory, session = FrameMemory(), uuid4()
    ingest = SessionIngest(session, memory, source=ListSource(frames)).start()
    ingest.join(5)
    assert not ingest.running
    assert ingest.stats.sampled == 5 and ingest.stats.accepted == 2 and ingest.stats.remembered == 2
    assert len(memory.frames(session)) == 2


class FakeBlurrer:
    def __init__(self, fail=False):
        self.fail = fail

    def blur(self, image):
        if self.fail:
            raise RuntimeError("detector crashed")
        return np.zeros_like(image), 1


def test_ingest_stores_the_blurred_image():
    memory, session = FrameMemory(), uuid4()
    ingest = SessionIngest(session, memory, source=ListSource([live_frame(scene(1))]), blurrer=FakeBlurrer()).start()
    ingest.join(5)
    assert ingest.stats.faces_blurred == 1
    assert memory.frames(session)[0].frame.max() == 0  # the stored copy is the blurred one


def test_ingest_drops_frame_when_face_blur_fails():
    memory, session = FrameMemory(), uuid4()
    ingest = SessionIngest(session, memory, source=ListSource([live_frame(scene(1))]), blurrer=FakeBlurrer(fail=True)).start()
    ingest.join(5)
    assert ingest.stats.dropped_blur_failed == 1 and memory.frames(session) == []


def test_frame_memory_forgets_after_two_minutes():
    now = [datetime(2026, 11, 8, 12, 0, tzinfo=UTC)]
    memory, session = FrameMemory(clock=lambda: now[0]), uuid4()
    old = memory.add(session, scene(1), now[0] - timedelta(seconds=110))
    new = memory.add(session, scene(2), now[0])
    assert [f.frame_id for f in memory.frames(session)] == [new.frame_id, old.frame_id]
    now[0] += timedelta(seconds=30)
    assert [f.frame_id for f in memory.frames(session)] == [new.frame_id]
    assert memory.get(old.frame_id) is None and memory.get(new.frame_id) is not None
    now[0] += timedelta(minutes=5)
    assert memory.count() == 0


def test_analyzer_keeps_the_memory_frame_id():
    repository, frame_id = FakeRepository(), uuid4()
    FrameAnalyzer(repository).analyze_and_save(uuid4(), live_frame(scene(1)), frame_id=frame_id)
    assert repository.saved[0].frame_id == frame_id


def test_watcher_starts_and_stops_with_the_phone_stream():
    session = uuid4()
    live = {session}
    started = []

    class Ingest:
        def __init__(self, session_id):
            self.alive = True
            started.append(self)

        def start(self):
            return self

        @property
        def running(self):
            return self.alive

        def stop(self):
            self.alive = False

        def join(self, timeout=None):
            pass

    watcher = StreamWatcher(Ingest, list_sessions=lambda: set(live))
    watcher.poll_once()
    watcher.poll_once()
    assert list(watcher.active) == [session] and len(started) == 1
    live.clear()
    watcher.poll_once()
    assert not started[0].alive
    watcher.poll_once()
    assert watcher.active == {}


def test_watcher_survives_mediamtx_being_down():
    def down():
        raise OSError("connection refused")
    watcher = StreamWatcher(lambda s: None, list_sessions=down)
    watcher.poll_once()
    assert watcher.mediamtx_reachable is False and watcher.active == {}


def test_live_sessions_reads_only_ready_live_uuid_paths(monkeypatch):
    ready, waiting = uuid4(), uuid4()
    body = {"items": [{"name": f"live/{ready}", "ready": True}, {"name": f"live/{waiting}", "ready": False},
                      {"name": "live/not-a-session", "ready": True}, {"name": f"other/{uuid4()}", "ready": True}]}

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.close()

    monkeypatch.setattr(pipeline.urllib.request, "urlopen", lambda url, timeout: Response(json.dumps(body).encode()))
    assert live_sessions("http://127.0.0.1:9997") == {ready}
