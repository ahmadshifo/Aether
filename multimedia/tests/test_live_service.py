"""Offline tests for automatic live ingestion: face blur + RAM memory + periodic saving + keep.
Uses ahmadshifo's MultimediaPipeline with the no-AI services and a fake repository; no network."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import cv2
import numpy as np

from api.routes import merge_live_frames
from processing.frame_memory import FrameMemory
from processing.live_service import (CombinedLivePipeline, LiveIngestManager, NoAIEmbedding, NoAIOCR, NoAIVision,
                                     keep_frames)
from processing.pipeline import MultimediaPipeline

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
SESSION = UUID("550e8400-e29b-41d4-a716-446655440000")


def scene(seed):
    image = np.random.default_rng(seed).integers(0, 255, (18, 24, 3), dtype=np.uint8)
    return cv2.resize(image, (320, 240), interpolation=cv2.INTER_NEAREST)


class FakeRepository:
    retention_hours = 24

    def __init__(self):
        self.saved = []

    def save_frame(self, session_id, captured_at, image, **fields):
        frame_id = fields.get("frame_id") or uuid4()
        self.saved.append(SimpleNamespace(session_id=session_id, captured_at=captured_at, image=image, **fields))
        return frame_id


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now


def pipeline(repository, memory, blurrer=None, save_every=15):
    inner = MultimediaPipeline(ocr_service=NoAIOCR(), vision_service=NoAIVision(), embedding_service=NoAIEmbedding(),
                               repository=repository, mocked=True)
    clock = Clock()
    return CombinedLivePipeline(inner, memory, blurrer, save_every, clock=clock), clock


def feed(combined, clock, image, index, seconds):
    clock.now = NOW + timedelta(seconds=seconds)
    return combined.process_live_frame(image, SESSION, captured_at=clock.now, source_frame_index=index,
                                       elapsed_ms=seconds * 1000)


def test_every_frame_is_remembered_but_only_one_per_interval_is_saved():
    repository, memory = FakeRepository(), FrameMemory(clock=lambda: NOW + timedelta(seconds=30))
    combined, clock = pipeline(repository, memory)
    outcomes = [feed(combined, clock, scene(i), i, i) for i in range(20)]
    assert len(memory.frames(SESSION)) == 20
    assert [o.status for o in outcomes].count("saved") == 2  # at 0 s and 15 s
    assert outcomes[1].selection_reason == "kept_in_memory"
    saved = repository.saved[0]
    assert (saved.ocr_text, saved.caption, saved.objects, saved.embedding) == ("", "", [], None)  # nothing invented


class FakeBlurrer:
    def __init__(self, fail=False):
        self.fail = fail

    def blur(self, image):
        if self.fail:
            raise RuntimeError("detector crashed")
        hidden = image.copy()
        hidden[:60, :80] = 0  # one "face" region; the rest stays sharp enough for the frame selector
        return hidden, 2


def test_saved_and_remembered_images_are_the_blurred_ones():
    repository, memory = FakeRepository(), FrameMemory(clock=lambda: NOW)
    combined, clock = pipeline(repository, memory, FakeBlurrer())
    feed(combined, clock, scene(1), 0, 0)
    assert combined.faces_blurred == 2
    assert repository.saved[0].image[:60, :80].max() == 0
    assert memory.frames(SESSION)[0].frame[:56, :76].max() < 40  # JPEG keeps the hidden region dark


def test_frame_is_dropped_everywhere_when_face_blur_fails():
    repository, memory = FakeRepository(), FrameMemory(clock=lambda: NOW)
    combined, clock = pipeline(repository, memory, FakeBlurrer(fail=True))
    outcome = feed(combined, clock, scene(1), 0, 0)
    assert outcome.status == "failed" and outcome.error_stage == "face_blur"
    assert memory.frames(SESSION) == [] and repository.saved == []


def test_keep_saves_answer_frames_under_their_memory_id():
    repository, memory = FakeRepository(), FrameMemory(clock=lambda: NOW)
    combined, _ = pipeline(repository, memory)
    item = memory.add(SESSION, scene(3), NOW, 7, 7000)
    assert keep_frames(combined.inner, [item]) == [str(item.frame_id)]
    assert repository.saved[0].frame_id == item.frame_id and repository.saved[0].source_frame_index == 7


def test_watcher_starts_and_stops_runners_with_the_stream():
    live, started = {SESSION}, []

    class Runner:
        def __init__(self, session_id):
            self._coordinator = SimpleNamespace(is_alive=lambda: not self.stopped)
            self.stopped = False
            started.append(self)

        def start(self):
            return self

        def stop(self, reason):
            self.stopped = True

    manager = LiveIngestManager(Runner, list_sessions=lambda: set(live))
    manager.poll_once()
    manager.poll_once()
    assert len(started) == 1 and list(manager.active) == [SESSION]
    live.clear()
    manager.poll_once()
    assert started[0].stopped
    manager.poll_once()
    assert manager.active == {}


def test_watcher_survives_mediamtx_being_down():
    def down():
        raise OSError("refused")
    manager = LiveIngestManager(lambda s: None, list_sessions=down)
    manager.poll_once()
    assert manager.mediamtx_reachable is False and manager.active == {}


def stored(seconds_ago, text):
    stamp = (NOW - timedelta(seconds=seconds_ago)).isoformat().replace("+00:00", "Z")
    frame_id = uuid4()
    return {"frame_id": str(frame_id), "session_id": str(SESSION), "timestamp": stamp, "captured_at": stamp,
            "image_url": f"/api/v1/frames/{frame_id}/image", "caption": text, "ocr_text": text, "objects": [],
            "relevance_score": 0.9}


def test_latest_merges_live_frames_newest_first():
    memory = FrameMemory(clock=lambda: NOW)
    for seconds in (9, 4, 1):
        memory.add(SESSION, scene(seconds), NOW - timedelta(seconds=seconds))
    memory.add(uuid4(), scene(99), NOW)  # another phone's frame never leaks
    settings = SimpleNamespace(latest_seconds=10, recent_seconds=120)
    frames = merge_live_frames(memory, [stored(6, "ROOM 205")], SESSION, "latest", 3, NOW, settings)
    assert [f["ocr_text"] for f in frames] == ["", "", "ROOM 205"]
    assert frames[0]["relevance_score"] > frames[1]["relevance_score"] > 0
    assert all(f["session_id"] == str(SESSION) for f in frames)


def test_recent_keeps_ranked_stored_matches_first_then_spreads_live_frames():
    memory = FrameMemory(clock=lambda: NOW)
    for seconds in range(100, 0, -10):
        memory.add(SESSION, scene(seconds), NOW - timedelta(seconds=seconds))
    settings = SimpleNamespace(latest_seconds=10, recent_seconds=120)
    frames = merge_live_frames(memory, [stored(50, "PHARMACY")], SESSION, "recent", 4, NOW, settings)
    assert frames[0]["ocr_text"] == "PHARMACY" and len(frames) == 4
