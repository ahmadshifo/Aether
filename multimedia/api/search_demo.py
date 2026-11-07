"""Explicit synthetic fixtures for offline/manual search verification only."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from database.repository import SearchCandidate
from processing.embedding_service import DEFAULT_MODEL, EXPECTED_DIMENSIONS, EmbeddingResult

DEMO_SESSION = UUID("550e8400-e29b-41d4-a716-446655440000")
OTHER_SESSION = UUID("550e8400-e29b-41d4-a716-446655440001")
DEMO_NOW = datetime(2026, 11, 5, 10, 30, tzinfo=UTC)


def synthetic_vector(axis=0):
    vector = [0.0] * EXPECTED_DIMENSIONS
    vector[axis] = 1.0
    return vector


class SyntheticQuery:
    """Named, deterministic test axes; this is not a semantic language model."""
    model = DEFAULT_MODEL

    def embed_query(self, query):
        lowered = query.casefold()
        axis = 0 if any(word in lowered for word in ("classroom", "room 205")) else (
            1 if "laptop" in lowered else 2 if "exit" in lowered else 3)
        return EmbeddingResult(DEFAULT_MODEL, EXPECTED_DIMENSIONS, query, synthetic_vector(axis))


def demo_candidates(now=DEMO_NOW, session_id=DEMO_SESSION, other_session_id=OTHER_SESSION):
    specifications = [
        (1, 30, "ROOM 205", ["door", "sign"], "A classroom door in a corridor.", 0, session_id),
        (2, 20, "", ["laptop", "keyboard"], "A laptop on a desk.", 1, session_id),
        (3, 15, "EXIT", ["door", "sign"], "An exit door at the end of a corridor.", 2, session_id),
        (4, 3, "", ["corridor"], "The current corridor.", None, session_id),
        (5, 3600, "ROOM 205", ["door", "sign"], "An older classroom door.", 0, session_id),
        (6, 1, "ROOM 205", ["door"], "Another session's door.", 0, other_session_id),
    ]
    return [SearchCandidate(UUID(int=identifier), session, now - timedelta(seconds=age), now + timedelta(hours=24),
                            ocr, objects, caption, None if axis is None else synthetic_vector(axis),
                            None if axis is None else DEFAULT_MODEL)
            for identifier, age, ocr, objects, caption, axis, session in specifications]


class InMemoryDemoRepository:
    def __init__(self, candidates):
        self.candidates = candidates

    def iter_search_candidates(self, session_id, start_time=None, end_time=None, *, now, batch_size=128):
        return (row for row in self.candidates if row.session_id == session_id and row.expires_at > now
                and (start_time is None or row.captured_at >= start_time)
                and (end_time is None or row.captured_at <= end_time))


def offline_components():
    return InMemoryDemoRepository(demo_candidates()), SyntheticQuery(), DEMO_NOW
