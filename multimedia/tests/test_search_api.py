"""Offline tests for /api/v1/search, /api/v1/frames, /api/v1/frames/keep and the image endpoint.
No MySQL, no OpenAI: fake repository, fake embedder, real in-RAM FrameMemory."""

import math
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app.routes import install_error_handlers, router
from api.app.search_service import SearchService, keyword_score, spread
from processing.frame_memory import FrameMemory

NOW = datetime(2026, 11, 8, 12, 0, 0, tzinfo=UTC)
SESSION = UUID("550e8400-e29b-41d4-a716-446655440000")


def unit(*values):
    vector = list(values) + [0.0] * (1536 - len(values))
    norm = math.sqrt(sum(v * v for v in vector))
    return [v / norm for v in vector]


TOPICS = {"door": unit(1, 0, 0), "bus": unit(0, 1, 0), "pharmacy": unit(0, 0, 1)}


def record(seconds_ago, caption, ocr="", objects=(), topic=None, session=SESSION, expired=False):
    captured = NOW - timedelta(seconds=seconds_ago)
    return SimpleNamespace(frame_id=uuid4(), session_id=session, captured_at=captured, caption=caption,
                           ocr_text=ocr, objects=list(objects),
                           embedding=TOPICS.get(topic), embedding_model="text-embedding-3-small" if topic else None,
                           expires_at=NOW - timedelta(seconds=1) if expired else captured + timedelta(hours=24))


class FakeRepository:
    def __init__(self, records):
        self.records = records
        self.images = {r.frame_id: b"\xff\xd8jpeg-" + str(r.frame_id).encode() + b"\xff\xd9" for r in records}

    def list_frames(self, session_id, limit=20, *, before=None):
        rows = sorted((r for r in self.records if r.session_id == session_id),
                      key=lambda r: (r.captured_at, r.frame_id), reverse=True)
        if before is not None:
            rows = [r for r in rows if (r.captured_at, r.frame_id) < (before.captured_at, before.frame_id)]
        return rows[:limit]

    def get_frame(self, frame_id):
        return next((r for r in self.records if r.frame_id == frame_id), None)

    def load_frame_image(self, frame_id):
        return self.images.get(frame_id)


class FakeAnalyzer:
    def __init__(self, repository, fail=False):
        self.repository, self.fail, self.saved = repository, fail, []

    def analyze_and_save(self, session_id, frame, frame_id=None):
        if self.fail:
            raise RuntimeError("synthetic outage")
        self.saved.append((session_id, frame_id))
        self.repository.records.append(SimpleNamespace(
            frame_id=frame_id, session_id=session_id, captured_at=frame.captured_at, caption="saved", ocr_text="",
            objects=[], embedding=None, expires_at=frame.captured_at + timedelta(hours=24)))
        return frame_id


class FakeEmbedder:
    def __init__(self, fail=False):
        self.fail, self.queries = fail, []

    def embed_query(self, query):
        self.queries.append(query)
        if self.fail:
            raise RuntimeError("synthetic outage")
        topic = next((t for t in TOPICS if t in query.lower()), None)
        return SimpleNamespace(embedding=TOPICS[topic] if topic else unit(1, 1, 1))


@pytest.fixture
def saved():
    return [
        record(30, "A wooden door with a room sign.", "ROOM 205", ["door", "sign"], "door"),
        record(600, "A pharmacy entrance.", "PHARMACY", ["door", "cross"], "pharmacy"),
        record(3600, "A corridor with a door.", "ROOM 101", ["door"], "door"),
        record(7200, "A bus stop.", "BUS 12", ["bus", "sign"], "bus"),
        record(30, "Another user's frame.", "ROOM 205", ["door"], "door", session=uuid4()),
        record(5, "Expired frame.", "ROOM 205", ["door"], "door", expired=True),
    ]


@pytest.fixture
def memory():
    memory = FrameMemory(clock=lambda: NOW)
    for seconds_ago, value in ((100, 40), (60, 80), (20, 120), (8, 160), (2, 200)):
        memory.add(SESSION, np.full((36, 64, 3), value, np.uint8), NOW - timedelta(seconds=seconds_ago))
    memory.add(uuid4(), np.full((36, 64, 3), 9, np.uint8), NOW)  # someone else's live frame
    return memory


def make_client(repository, memory=None, embedder=None, analyzer=None):
    app = FastAPI()
    app.include_router(router)
    install_error_handlers(app)
    app.state.repository = repository
    app.state.memory = memory
    app.state.analyzer = analyzer
    app.state.keeper = lambda job: job()  # run "background" saving immediately in tests
    app.state.search = SearchService(repository, memory, embedder, clock=lambda: NOW)
    return TestClient(app)


def search(client, query, mode, limit=5, session=SESSION):
    return client.post("/api/v1/search", json={"session_id": str(session), "query": query, "mode": mode, "limit": limit})


def ages(body):
    return [round((NOW - datetime.fromisoformat(f["captured_at"].replace("Z", "+00:00"))).total_seconds())
            for f in body["frames"]]


def test_latest_returns_live_frames_from_last_10_seconds(saved, memory):
    body = search(make_client(FakeRepository(saved), memory), "what is in front of me", "latest").json()
    assert ages(body) == [2, 8]
    scores = [f["relevance_score"] for f in body["frames"]]
    assert scores[0] > scores[1] > 0


def test_recent_spreads_live_frames_over_two_minutes(saved, memory):
    body = search(make_client(FakeRepository(saved), memory), "what did I pass", "recent", 3).json()
    assert ages(body) == [2, 20, 100]
    assert all(f["caption"] == "" and f["ocr_text"] == "" for f in body["frames"])  # not analyzed until kept


def test_live_frames_never_leak_between_sessions(saved, memory):
    assert search(make_client(FakeRepository(saved), memory), "", "latest", session=uuid4()).json() == {"frames": []}


def test_history_ranks_saved_frames_by_meaning(saved, memory):
    body = search(make_client(FakeRepository(saved), memory, FakeEmbedder()), "where was the pharmacy", "history").json()
    assert body["frames"][0]["ocr_text"] == "PHARMACY"
    captions = [f["caption"] for f in body["frames"]]
    assert "Another user's frame." not in captions and "Expired frame." not in captions


def test_history_falls_back_to_word_matching(saved):
    embedder = FakeEmbedder(fail=True)
    body = search(make_client(FakeRepository(saved), None, embedder), "ROOM 205", "history").json()
    assert body["frames"][0]["ocr_text"] == "ROOM 205" and embedder.queries == ["ROOM 205"]
    assert search(make_client(FakeRepository(saved)), "giraffe", "history").json() == {"frames": []}


def test_response_matches_contract_shape(saved, memory):
    for mode in ("latest", "history"):
        frame = search(make_client(FakeRepository(saved), memory, FakeEmbedder()), "door", mode, 1).json()["frames"][0]
        assert set(frame) == {"frame_id", "session_id", "captured_at", "image_url", "caption", "ocr_text", "objects", "relevance_score"}
        assert frame["image_url"] == f"/api/v1/frames/{frame['frame_id']}/image"
        assert frame["captured_at"].endswith("Z") and 0 <= frame["relevance_score"] <= 1


@pytest.mark.parametrize("change", [{"mode": "yesterday"}, {"limit": 0}, {"limit": 21}, {"session_id": "abc"}, {"extra": 1}])
def test_invalid_requests_use_shared_error_shape(saved, change):
    payload = {"session_id": str(SESSION), "query": "door", "mode": "recent", "limit": 5, **change}
    response = make_client(FakeRepository(saved)).post("/api/v1/search", json=payload)
    assert response.status_code == 400 and response.json()["error"]["code"] == "invalid_request"


def test_database_down_still_serves_live_search_but_not_history(memory):
    client = make_client(None, memory)
    assert len(search(client, "", "latest").json()["frames"]) == 2
    response = search(client, "door", "history")
    assert response.status_code == 503 and response.json()["error"]["code"] == "storage_unavailable"


def test_keep_saves_only_the_answer_frames(saved, memory):
    repository = FakeRepository(saved)
    analyzer = FakeAnalyzer(repository)
    client = make_client(repository, memory, analyzer=analyzer)
    live = search(client, "", "latest").json()["frames"]
    other_session = memory.frames(next(s for s in memory._sessions if s != SESSION))[0].frame_id
    response = client.post("/api/v1/frames/keep", json={"session_id": str(SESSION),
                                                        "frame_ids": [live[0]["frame_id"], str(other_session), str(uuid4())]})
    assert response.status_code == 202
    body = response.json()
    assert body["accepted"] == [live[0]["frame_id"]] and len(body["missing"]) == 2
    assert analyzer.saved == [(SESSION, UUID(live[0]["frame_id"]))]
    # The kept frame now appears in history under the same frame_id the answer referenced.
    history = search(client, "", "history", 20).json()["frames"]
    assert live[0]["frame_id"] in [f["frame_id"] for f in history]
    # Asking again is harmless: already-saved frames are reported as accepted.
    again = client.post("/api/v1/frames/keep", json={"session_id": str(SESSION), "frame_ids": [str(saved[0].frame_id)]})
    assert again.json() == {"accepted": [str(saved[0].frame_id)], "missing": []}


def test_keep_needs_storage(memory):
    response = make_client(None, memory).post("/api/v1/frames/keep", json={"session_id": str(SESSION), "frame_ids": [str(uuid4())]})
    assert response.status_code == 503


def test_keep_rejects_empty_or_huge_lists(saved, memory):
    client = make_client(FakeRepository(saved), memory, analyzer=FakeAnalyzer(FakeRepository([])))
    for ids in ([], [str(uuid4()) for _ in range(21)]):
        assert client.post("/api/v1/frames/keep", json={"session_id": str(SESSION), "frame_ids": ids}).status_code == 400


def test_timeline_lists_saved_frames_with_cursor(saved):
    client = make_client(FakeRepository(saved))
    first = client.get("/api/v1/frames", params={"session_id": str(SESSION), "limit": 2}).json()
    assert [f["ocr_text"] for f in first["frames"]] == ["ROOM 205", "PHARMACY"] and first["next_cursor"]
    second = client.get("/api/v1/frames", params={"session_id": str(SESSION), "limit": 2, "cursor": first["next_cursor"]}).json()
    assert [f["ocr_text"] for f in second["frames"]] == ["ROOM 101", "BUS 12"] and second["next_cursor"] is None


def test_timeline_rejects_bad_cursor(saved):
    response = make_client(FakeRepository(saved)).get("/api/v1/frames", params={"session_id": str(SESSION), "cursor": "nope"})
    assert response.status_code == 400 and response.json()["error"]["code"] == "invalid_cursor"


def test_image_endpoint_serves_live_and_saved_and_hides_missing(saved, memory):
    repository = FakeRepository(saved)
    client = make_client(repository, memory)
    live = memory.frames(SESSION)[0]
    response = client.get(f"/api/v1/frames/{live.frame_id}/image")
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg" and response.content == live.jpeg
    stored = client.get(f"/api/v1/frames/{saved[0].frame_id}/image")
    assert stored.status_code == 200 and stored.content == repository.images[saved[0].frame_id]
    expired = next(f for f in saved if f.caption == "Expired frame.")
    for frame_id in (expired.frame_id, uuid4()):
        missing = client.get(f"/api/v1/frames/{frame_id}/image")
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "frame_not_found"


def test_helpers():
    assert keyword_score("room 205", SimpleNamespace(ocr_text="ROOM 205", caption="", objects=[])) == 1.0
    assert spread(list(range(10)), 3) == [0, 4, 9] and spread([1, 2], 5) == [1, 2] and spread([1, 2, 3], 1) == [1]
