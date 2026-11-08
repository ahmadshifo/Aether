"""Opt-in Task 11 tests against real MySQL; query vectors remain synthetic."""

from datetime import UTC, datetime, timedelta, timezone
import json
import os
from unittest.mock import Mock, patch
from uuid import uuid4

import numpy as np
import pytest
from sqlalchemy import text, update

from api.search_demo import synthetic_vector
from api.search_service import SearchService, SearchSettings
from database.connection import Database
from database.models import Frame
from database.repository import FrameRepository, SearchCandidate
from processing.embedding_service import DEFAULT_MODEL, EmbeddingResult

pytestmark = pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1",
                                reason="Set RUN_MYSQL_TESTS=1 for real MySQL search integration tests")


@pytest.fixture(scope="module")
def live_database():
    with Database() as database:
        database.check()
        yield database


@pytest.fixture
def stored(live_database, tmp_path):
    now = datetime.now(UTC)
    session_a, session_b = uuid4(), uuid4()
    repository = FrameRepository(live_database.sessions, tmp_path / "private_images")
    identifiers = []
    image = np.full((24, 32, 3), 150, dtype=np.uint8)

    def save(age=30, axis=0, **kwargs):
        identifier = kwargs.pop("frame_id", uuid4())
        identifiers.append(identifier)
        return repository.save_frame(
            kwargs.pop("session_id", session_a), kwargs.pop("captured_at", now - timedelta(seconds=age)), image,
            frame_id=identifier, ocr_text=kwargs.pop("ocr_text", "ROOM 205"),
            objects=kwargs.pop("objects", ["door", "sign"]), caption=kwargs.pop("caption", "A classroom door."),
            embedding=None if axis is None else synthetic_vector(axis),
            embedding_model=None if axis is None else DEFAULT_MODEL, **kwargs)

    embedding = Mock()
    embedding.model = DEFAULT_MODEL
    embedding.embed_query.return_value = EmbeddingResult(DEFAULT_MODEL, 1536, "classroom door", synthetic_vector())

    def search(*, settings=None):
        return SearchService(repository, embedding, clock=lambda: now,
                             settings=SearchSettings(batch_size=2) if settings is None else settings)

    try:
        yield repository, save, search, session_a, session_b, now, embedding, identifiers
    finally:
        for identifier in identifiers:
            repository.delete_frame(identifier)  # Generated UUIDs only; no resets or unrelated deletion.


def test_existing_mysql_connection(live_database):
    assert live_database.check()["mysql_version"].startswith(("8.0.", "8.4."))


def test_real_json_metadata_and_projection(stored, live_database):
    repository, save, _, session, _, now, _, _ = stored
    identifier = save()
    rows = list(repository.iter_search_candidates(session, now=now, end_time=now))
    assert len(rows) == 1 and isinstance(rows[0], SearchCandidate)
    assert rows[0].frame_id == identifier and rows[0].ocr_text == "ROOM 205"
    assert rows[0].objects == ["door", "sign"] and rows[0].caption == "A classroom door."
    assert rows[0].embedding == synthetic_vector() and not hasattr(rows[0], "image_path")
    with live_database.engine.connect() as connection:
        actual = connection.execute(text("SELECT JSON_TYPE(embedding), JSON_LENGTH(embedding) FROM frames WHERE frame_id = :id"),
                                    {"id": str(identifier)}).one()
        assert tuple(actual) == ("ARRAY", 1536)


def test_latest_includes_ten_seconds_but_not_old_scene(stored):
    _, save, search, session, _, _, embedding, _ = stored
    boundary, newest = save(10), save(2)
    save(10.000001)
    save(7200)
    result = search().search(session, "door", "latest")
    assert [row["frame_id"] for row in result["frames"]] == [str(newest), str(boundary)]
    embedding.embed_query.assert_not_called()


def test_recent_includes_two_minutes_and_uses_capture_time(stored):
    _, save, search, session, _, _, _, _ = stored
    boundary, current = save(120), save(30)
    save(120.000001)
    save(7200)  # Inserted now but captured hours ago.
    frames = search().search(session, "classroom", "recent")["frames"]
    assert {row["frame_id"] for row in frames} == {str(boundary), str(current)}


def test_history_retrieves_older_retained_frames(stored):
    _, save, search, session, _, _, _, _ = stored
    older = save(7200)
    assert search().search(session, "classroom", "recent") == {"frames": []}
    assert search().search(session, "classroom", "history")["frames"][0]["frame_id"] == str(older)


def test_semantic_ranking_and_single_mocked_query_embedding(stored):
    _, save, search, session, _, _, embedding, _ = stored
    save(20, axis=1, ocr_text="", objects=["laptop"], caption="A laptop on a desk.")
    desired = save(30)
    save(15, axis=2, ocr_text="EXIT")
    assert search().search(session, "What was written on the classroom door?")["frames"][0]["frame_id"] == str(desired)
    embedding.embed_query.assert_called_once_with("What was written on the classroom door?")


def test_exact_ocr_room_number_boost(stored):
    _, save, search, session, _, _, _, _ = stored
    correct = save(50)
    save(10, ocr_text="ROOM 206")
    frames = search().search(session, "What does ROOM 205 say?")["frames"]
    assert frames[0]["frame_id"] == str(correct)
    assert frames[0]["relevance_score"] > frames[1]["relevance_score"]


def test_session_isolation_in_sql_and_service(stored):
    repository, save, search, session_a, session_b, now, _, _ = stored
    first, second = save(), save(session_id=session_b)
    assert [row.frame_id for row in repository.iter_search_candidates(session_a, now=now)] == [first]
    assert [row["frame_id"] for row in search().search(session_a, "door")["frames"]] == [str(first)]
    assert [row["frame_id"] for row in search().search(session_b, "door")["frames"]] == [str(second)]


def test_expiration_and_future_capture_filtered_in_mysql(stored, live_database):
    repository, save, search, session, _, now, _, _ = stored
    expired, exact_expiry, valid = save(), save(), save()
    save(-0.000001)
    with live_database.engine.begin() as connection:
        for identifier, expiry in ((expired, now - timedelta(seconds=1)), (exact_expiry, now)):
            connection.execute(update(Frame).where(Frame.frame_id == identifier).values(
                created_at=now - timedelta(hours=2), expires_at=expiry))
    rows = list(repository.iter_search_candidates(session, end_time=now, now=now))
    assert [row.frame_id for row in rows] == [valid]
    assert [row["frame_id"] for row in search().search(session, "door", "history")["frames"]] == [str(valid)]


def test_contract_metadata_and_no_private_paths_or_vectors(stored):
    _, save, search, session, _, now, _, _ = stored
    identifier = save(ocr_text="ROOM 205\nSECOND FLOOR", caption="Caption unchanged.", objects=[" Door ", "sign"])
    row = search().search(session, "door")["frames"][0]
    assert row["frame_id"] == str(identifier) and row["session_id"] == str(session)
    assert row["timestamp"] == row["captured_at"] == (now - timedelta(seconds=30)).isoformat().replace("+00:00", "Z")
    assert row["image_url"] == f"/api/v1/frames/{identifier}/image"
    assert row["ocr_text"] == "ROOM 205\nSECOND FLOOR" and row["caption"] == "Caption unchanged."
    assert row["objects"] == [" Door ", "sign"] and 0 <= row["relevance_score"] <= 1
    assert "image_path" not in row and "embedding" not in row
    json.dumps(row, allow_nan=False)


def test_stable_keyset_order_and_result_limit(stored):
    repository, save, search, session, _, now, _, _ = stored
    identifiers = [save(frame_id=uuid4()) for _ in range(3)]
    # Two records per SQL page, with identical capture times.
    candidates = list(repository.iter_search_candidates(session, now=now, batch_size=2))
    assert [row.frame_id for row in candidates] == sorted(identifiers, reverse=True)
    frames = search().search(session, "door", limit=2)["frames"]
    assert [row["frame_id"] for row in frames] == [str(value) for value in sorted(identifiers, reverse=True)[:2]]


def test_search_is_read_only_and_does_not_load_jpegs(stored, live_database):
    repository, save, search, session, _, _, _, _ = stored
    identifier = save()
    before = repository.get_frame(identifier)
    with patch.object(repository, "load_frame_image", side_effect=AssertionError("No image reads")), \
            patch.object(repository, "save_frame", side_effect=AssertionError("No writes")), \
            patch.object(repository, "delete_frame", side_effect=AssertionError("No deletes")):
        assert search().search(session, "door")["frames"]
    assert repository.get_frame(identifier) == before


def test_missing_embedding_ocr_fallback_and_threshold_no_match(stored):
    _, save, search, session, _, _, _, _ = stored
    missing = save(axis=None)
    result = search().search(session, "ROOM 205")["frames"]
    assert result[0]["frame_id"] == str(missing) and result[0]["relevance_score"] == 0
    save(axis=1)
    strict = search(settings=SearchSettings(min_similarity=0.6))
    assert strict.search(session, "classroom") == {"frames": []}


def test_timezone_conversion_and_custom_sql_time_bounds(stored):
    repository, save, _, session, _, now, _, _ = stored
    zone = timezone(timedelta(hours=2))
    local_capture = (now - timedelta(seconds=45)).astimezone(zone)
    identifier = save(captured_at=local_capture)
    rows = list(repository.iter_search_candidates(session,
                start_time=(now - timedelta(seconds=45)).astimezone(zone), end_time=local_capture, now=now))
    assert [row.frame_id for row in rows] == [identifier]
    assert rows[0].captured_at == local_capture.astimezone(UTC)


def test_history_has_no_hidden_first_few_hundred_cutoff(stored, live_database):
    repository, _, search, session, _, now, _, identifiers = stored
    rows = []
    for index in range(321):
        identifier = uuid4()
        identifiers.append(identifier)
        rows.append(Frame(frame_id=identifier, session_id=session, captured_at=now - timedelta(seconds=index + 1),
                          image_path=f"{session}/{identifier}.jpg", objects=[], ocr_text="", caption="Synthetic batch.",
                          embedding=synthetic_vector(0 if index == 320 else 1), embedding_model=DEFAULT_MODEL))
    with live_database.sessions.begin() as sql_session:
        sql_session.add_all(rows)
    # Synthetic metadata-only rows intentionally have no JPEG. Search must not open it.
    settings = SearchSettings(batch_size=17, min_similarity=0.5)
    frames = search(settings=settings).search(session, "classroom", "history", 1)["frames"]
    assert [row["frame_id"] for row in frames] == [str(identifiers[-1])]
    assert repository.count_frames(session) == 321
