"""Task 11 behavior tests: synthetic metadata/vectors, no MySQL or AI access."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID
import weakref

import httpx
import numpy as np
import pymysql
import pytest
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import SQLAlchemyError

from api import search_service as module
from api.search_demo import synthetic_vector
from api.search_service import (SearchConfigurationError, SearchEmbeddingError, SearchRepositoryError,
                                SearchService, SearchSettings, main)
from database.errors import RepositoryError
from database.repository import FrameRecord, FrameRepository, SearchCandidate
from processing.embedding_service import DEFAULT_MODEL, EmbeddingResult, cosine_similarity

NOW = datetime(2026, 11, 5, 10, 30, 0, 123456, tzinfo=UTC)
SESSION = UUID("550e8400-e29b-41d4-a716-446655440000")
OTHER = UUID("550e8400-e29b-41d4-a716-446655440001")


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "ENV_FILE", tmp_path / "absent.env")
    for key in ("LATEST_SECONDS", "RECENT_SECONDS", "DEFAULT_LIMIT", "MAX_LIMIT", "BATCH_SIZE", "MIN_SIMILARITY", "OCR_BOOST"):
        monkeypatch.delenv("SEARCH_" + key, raising=False)
    def forbid(*args, **kwargs):
        pytest.fail("Search unit tests must not contact MySQL or HTTP")
    monkeypatch.setattr(pymysql, "connect", forbid)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid)


def candidate(identifier=1, age=30, **changes):
    row = SearchCandidate(UUID(int=identifier), SESSION, NOW - timedelta(seconds=age), NOW + timedelta(hours=24),
                          "ROOM 205", ["door", "sign"], "A classroom door.", synthetic_vector(), DEFAULT_MODEL)
    return replace(row, **changes)


class FakeRepository:
    def __init__(self, rows=()):
        self.rows, self.calls = rows, []

    def iter_search_candidates(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return iter(self.rows)


class FakeEmbeddings:
    model = DEFAULT_MODEL

    def __init__(self, vector=None):
        self.vector = synthetic_vector() if vector is None else vector
        self.calls = []

    def embed_query(self, query):
        self.calls.append(query)
        return EmbeddingResult(DEFAULT_MODEL, 1536, query, self.vector)


def service(rows=(), settings=None, embedding=None):
    return SearchService(FakeRepository(rows), FakeEmbeddings() if embedding is None else embedding,
                         settings=SearchSettings() if settings is None else settings, clock=lambda: NOW)


def ids(response):
    return [UUID(row["frame_id"]).int for row in response["frames"]]


def test_valid_request_and_single_unchanged_query_embedding():
    search = service([candidate(1), candidate(2)])
    result = search.search(str(SESSION), "What was written on the classroom door?", "recent", 5)
    assert ids(result) == [2, 1]
    assert search.embedding_service.calls == ["What was written on the classroom door?"]
    args, options = search.repository.calls[0]
    assert args == (SESSION,)
    assert options == dict(start_time=NOW - timedelta(seconds=120), end_time=NOW, now=NOW, batch_size=128)


@pytest.mark.parametrize("bad", ["bad", "../x", None, 123, "' OR 1=1 --"])
def test_invalid_session_rejected_before_io(bad):
    search = service([candidate()])
    with pytest.raises(ValueError, match="UUID"):
        search.search(bad, "door")
    assert not search.repository.calls and not search.embedding_service.calls


@pytest.mark.parametrize("query", ["", "  \n", None, 123, "x" * 8193, "\ud800"])
def test_invalid_query_rejected_before_io(query):
    search = service()
    with pytest.raises((ValueError, TypeError)):
        search.search(SESSION, query)
    assert not search.repository.calls and not search.embedding_service.calls


@pytest.mark.parametrize("mode", ["", "live", "all", None, []])
def test_invalid_modes(mode):
    search = service()
    with pytest.raises(ValueError, match="mode"):
        search.search(SESSION, "door", mode)
    assert not search.repository.calls


@pytest.mark.parametrize("limit", [0, -1, 21, 1.5, "5", True, float("nan"), None])
def test_invalid_limits(limit):
    search = service()
    with pytest.raises(ValueError, match="limit"):
        search.search(SESSION, "door", limit=limit)
    assert not search.repository.calls and not search.embedding_service.calls


def test_latest_uses_capture_time_not_similarity_or_insertion_and_needs_no_embedding():
    search = service([candidate(1, age=9), candidate(2, age=1, embedding=None, embedding_model=None), candidate(3, age=3600)])
    result = search.search(SESSION, "door", "latest")
    assert ids(result) == [2, 1]
    assert not search.embedding_service.calls
    assert all(row["relevance_score"] == 0.0 for row in result["frames"])


@pytest.mark.parametrize("mode, boundary", [("latest", 10), ("recent", 120)])
def test_time_boundary_is_inclusive_to_microsecond(mode, boundary):
    search = service([candidate(1, age=boundary), candidate(2, age=boundary + 0.000001), candidate(3, age=-0.000001)])
    assert ids(search.search(SESSION, "door", mode)) == [1]


def test_recent_filters_two_minutes():
    assert ids(service([candidate(1, 119), candidate(2, 121)]).search(SESSION, "door")) == [1]


def test_history_includes_old_retained_capture_but_not_expired_or_future():
    search = service([candidate(1, 7200), candidate(2, 5, expires_at=NOW), candidate(3, -1),
                      candidate(4, 90000, expires_at=NOW + timedelta(hours=1))])
    # Retention follows expires_at, not an invented captured_at+24h deadline.
    assert ids(search.search(SESSION, "door", "history")) == [1, 4]
    assert search.repository.calls[0][1]["start_time"] is None


def test_timezone_aware_non_utc_values_are_normalized():
    zone = timezone(timedelta(hours=2))
    row = candidate(captured_at=(NOW - timedelta(seconds=10)).astimezone(zone), expires_at=(NOW + timedelta(hours=1)).astimezone(zone))
    result = service([row]).search(SESSION, "door", "latest")["frames"][0]
    assert result["timestamp"] == (NOW - timedelta(seconds=10)).isoformat().replace("+00:00", "Z")
    assert result["captured_at"] == result["timestamp"]


def test_naive_or_missing_capture_is_not_invented():
    rows = [candidate(1, captured_at=None), candidate(2, captured_at=NOW.replace(tzinfo=None)), candidate(3)]
    assert ids(service(rows).search(SESSION, "door")) == [3]


def test_naive_clock_rejected_before_io():
    search = service()
    search.clock = lambda: NOW.replace(tzinfo=None)
    with pytest.raises(ValueError, match="timezone-aware"):
        search.search(SESSION, "door")
    assert not search.repository.calls


def test_session_isolation_even_when_repository_leaks_rows():
    assert ids(service([candidate(1), candidate(2, session_id=OTHER)]).search(SESSION, "door")) == [1]


@pytest.mark.parametrize("embedding, model", [
    ([1.0] * 1535, DEFAULT_MODEL), ([1.0] * 1537, DEFAULT_MODEL),
    ([float("nan")] * 1536, DEFAULT_MODEL), ([float("inf")] * 1536, DEFAULT_MODEL),
    ([True] * 1536, DEFAULT_MODEL), ([0.0] * 1536, DEFAULT_MODEL),
    ({"wrong": "shape"}, DEFAULT_MODEL), ("bad", DEFAULT_MODEL),
    ([[1.0]] * 1536, DEFAULT_MODEL), (synthetic_vector(), "wrong-model"),
])
def test_invalid_candidate_vectors_excluded_without_losing_valid_rows(embedding, model):
    search = service([candidate(1, embedding=embedding, embedding_model=model), candidate(2)])
    assert ids(search.search(SESSION, "door")) == [2]
    assert len(search.embedding_service.calls) == 1


def test_missing_embedding_exact_ocr_fallback_is_zero_not_semantic_confidence():
    search = service([candidate(1, embedding=None, embedding_model=None),
                      candidate(2, ocr_text="ROOM 206", embedding=None, embedding_model=None)])
    result = search.search(SESSION, "What says ROOM 205?")
    assert ids(result) == [1] and result["frames"][0]["relevance_score"] == 0
    assert not search.embedding_service.calls
    assert service([candidate(embedding=None, embedding_model=None)]).search(SESSION, "door") == {"frames": []}


def test_semantic_threshold_excludes_missing_vectors_even_with_exact_ocr():
    search = service([candidate(embedding=None, embedding_model=None)], SearchSettings(min_similarity=0))
    assert search.search(SESSION, "ROOM 205") == {"frames": []}


def test_predictable_cosine_ranking_uses_existing_task9_function():
    search = service([candidate(1, embedding=synthetic_vector(1)), candidate(2),
                      candidate(3, embedding=(-np.array(synthetic_vector())).tolist())], SearchSettings(ocr_boost=0))
    with patch.object(module, "cosine_similarity", wraps=cosine_similarity) as cosine:
        result = search.search(SESSION, "door")
    assert cosine.call_count == 3
    assert ids(result) == [2, 1, 3]
    assert [row["relevance_score"] for row in result["frames"]] == pytest.approx([1, 0.5, 0])


def test_equal_scores_use_newer_capture_then_descending_uuid():
    result = service([candidate(1, 10), candidate(3, 20), candidate(2, 10)]).search(SESSION, "door")
    assert ids(result) == [2, 1, 3]


def test_result_limit_and_empty_dataset_do_not_waste_embedding_calls():
    assert len(service([candidate(i) for i in range(1, 9)]).search(SESSION, "door", limit=2)["frames"]) == 2
    search = service()
    assert search.search(SESSION, "door") == {"frames": []}
    assert not search.embedding_service.calls


def test_exact_ocr_boost_preserves_room_number_and_can_be_disabled():
    rows = [candidate(1, 50), candidate(2, 10, ocr_text="ROOM 206")]
    assert ids(service(rows).search(SESSION, "What does ROOM 205 say?")) == [1, 2]
    assert ids(service(rows, SearchSettings(ocr_boost=0)).search(SESSION, "What does ROOM 205 say?")) == [2, 1]
    assert ids(service(rows).search(SESSION, "ROOM 2050")) == [2, 1]


def test_exact_ocr_line_in_multiline_text_is_preserved_and_boosted():
    rows = [candidate(1, 50, ocr_text="ROOM 205\nSECOND FLOOR"), candidate(2, 10, ocr_text="ROOM 206\nSECOND FLOOR")]
    response = service(rows).search(SESSION, "What says ROOM 205?")
    assert ids(response) == [1, 2]
    assert response["frames"][0]["ocr_text"] == "ROOM 205\nSECOND FLOOR"


def test_metadata_contract_and_private_information_boundary():
    original = candidate(caption="Original caption.  ", ocr_text="ROOM 205\nSECOND FLOOR", objects=[" Door ", "sign"])
    result = service([original]).search(SESSION, "door")["frames"][0]
    assert set(result) == {"frame_id", "session_id", "timestamp", "captured_at", "image_url", "caption", "ocr_text", "objects", "relevance_score"}
    assert result["caption"] == original.caption and result["ocr_text"] == original.ocr_text
    assert result["objects"] == original.objects
    assert result["image_url"] == f"/api/v1/frames/{original.frame_id}/image"
    assert UUID(result["frame_id"]) == original.frame_id and UUID(result["session_id"]) == SESSION
    assert 0 <= result["relevance_score"] <= 1
    assert all(word not in result for word in ("image_path", "embedding", "embedding_model", "database_url"))
    result["objects"].append("chair")
    assert original.objects == [" Door ", "sign"]
    json.dumps(result, allow_nan=False)


def test_task10_frame_record_is_supported_without_loading_its_private_image():
    item = candidate()
    row = FrameRecord(item.frame_id, item.session_id, item.captured_at, 1, 250,
                      "private/not-to-be-opened.jpg", item.ocr_text, item.objects, item.caption,
                      item.embedding, item.embedding_model, NOW, item.expires_at)
    search = service([row])
    with patch.object(Path, "read_bytes", side_effect=AssertionError("No images during search")):
        assert ids(search.search(SESSION, "door")) == [1]
    assert set(vars(search.repository)) == {"rows", "calls"}


@pytest.mark.parametrize("threshold, count", [(None, 1), (0.2, 0), (0.0, 1), (-1, 1)])
def test_raw_cosine_threshold_not_a_universal_probability(threshold, count):
    result = service([candidate(embedding=synthetic_vector(1))], SearchSettings(min_similarity=threshold)).search(SESSION, "door")
    assert len(result["frames"]) == count


def test_latest_ignores_semantic_threshold_and_never_reports_semantic_confidence():
    result = service([candidate(age=2)], SearchSettings(min_similarity=1)).search(SESSION, "unrelated", "latest")
    assert ids(result) == [1] and result["frames"][0]["relevance_score"] == 0


def test_repository_failure_does_not_return_partial_matches_or_secrets():
    def failing():
        yield candidate()
        raise RepositoryError("password=private-value")
    search = service(failing())
    with pytest.raises(SearchRepositoryError) as caught:
        search.search(SESSION, "door")
    assert "private-value" not in str(caught.value)


def test_repository_call_failure_is_controlled():
    search = service()
    search.repository.iter_search_candidates = Mock(side_effect=RuntimeError("private-value"))
    with pytest.raises(SearchRepositoryError, match="retrieve"):
        search.search(SESSION, "door")
    assert not search.embedding_service.calls


def test_embedding_failure_closes_iterator_and_does_not_fabricate_results():
    closed = []
    def records():
        try:
            yield candidate()
        finally:
            closed.append(True)
    embedding = FakeEmbeddings()
    embedding.embed_query = Mock(side_effect=RuntimeError("secret-provider-body"))
    with pytest.raises(SearchEmbeddingError) as caught:
        service(records(), embedding=embedding).search(SESSION, "door")
    assert closed == [True] and "secret-provider-body" not in str(caught.value)


@pytest.mark.parametrize("model, dimensions, vector", [
    ("different-model", 1536, synthetic_vector()), (DEFAULT_MODEL, 512, synthetic_vector()),
    (DEFAULT_MODEL, 1536, [1.0] * 10), (DEFAULT_MODEL, 1536, [float("inf")] * 1536),
])
def test_invalid_query_embedding_is_rejected(model, dimensions, vector):
    embedding = FakeEmbeddings()
    embedding.embed_query = Mock(return_value=EmbeddingResult(model, dimensions, "door", vector))
    with pytest.raises(SearchEmbeddingError):
        service([candidate()], embedding=embedding).search(SESSION, "door")


def test_existing_task9_sdk_service_is_reused():
    from openai.types import CreateEmbeddingResponse, Embedding
    from openai.types.create_embedding_response import Usage
    from processing.embedding_service import EmbeddingService
    client = Mock()
    client.with_options.return_value = client
    client.embeddings.create.return_value = CreateEmbeddingResponse(
        data=[Embedding(index=0, object="embedding", embedding=synthetic_vector())], model=DEFAULT_MODEL,
        object="list", usage=Usage(prompt_tokens=1, total_tokens=1))
    embedding = EmbeddingService(client=client, model=DEFAULT_MODEL, dimensions=1536)
    assert ids(service([candidate(), candidate(2)], embedding=embedding).search(SESSION, "door")) == [2, 1]
    client.embeddings.create.assert_called_once()
    assert client.embeddings.create.call_args.kwargs["input"] == "door"
    assert client.embeddings.create.call_args.kwargs["dimensions"] == 1536


def test_incremental_full_history_keeps_only_bounded_matches_alive():
    stats = {"alive": 0, "maximum": 0, "seen": 0}
    def released():
        stats["alive"] -= 1
    def records():
        for i in range(1, 702):
            row = candidate(i, age=i, embedding=synthetic_vector(0 if i == 701 else 1))
            stats["alive"] += 1
            stats["maximum"] = max(stats["maximum"], stats["alive"])
            stats["seen"] += 1
            weakref.finalize(row, released)
            yield row
    search = service(records(), SearchSettings(min_similarity=0.5))
    assert ids(search.search(SESSION, "door", "history", 1)) == [701]
    assert stats["seen"] == 701 and stats["maximum"] <= 3
    assert len(search.embedding_service.calls) == 1


def test_repository_filters_bound_parameters_and_closes_each_batch_before_yield(tmp_path):
    session = MagicMock()
    session.__enter__.return_value = session
    rows = [candidate(3), candidate(2), candidate(1, 40)]
    mappings = lambda row: dict(vars(row))
    session.execute.return_value.mappings.return_value.all.side_effect = [[mappings(r) for r in rows[:2]], [mappings(rows[2])]]
    repository = FrameRepository(Mock(return_value=session), tmp_path)
    iterator = repository.iter_search_candidates(SESSION, NOW - timedelta(seconds=120), NOW, now=NOW, batch_size=2)
    assert next(iterator).frame_id == rows[0].frame_id
    assert session.__exit__.call_count == 1
    assert [row.frame_id for row in iterator] == [rows[1].frame_id, rows[2].frame_id]
    assert session.__exit__.call_count == 2
    first, second = [call.args[0] for call in session.execute.call_args_list]
    sql = str(first.compile(dialect=mysql.dialect()))
    assert "frames.session_id =" in sql and "frames.expires_at >" in sql
    assert "frames.captured_at >=" in sql and "frames.captured_at <=" in sql
    assert "frames.image_path" not in sql and "ORDER BY frames.captured_at DESC, frames.frame_id DESC" in sql
    assert first.compile().params["session_id_1"] == SESSION
    assert "frames.frame_id <" in str(second)
    session.commit.assert_not_called()
    session.add.assert_not_called()
    session.delete.assert_not_called()


def test_repository_sql_error_is_sanitized_and_session_closed(tmp_path):
    session = MagicMock()
    session.__enter__.return_value = session
    session.execute.side_effect = SQLAlchemyError("private-password")
    iterator = FrameRepository(Mock(return_value=session), tmp_path).iter_search_candidates(SESSION, now=NOW)
    with pytest.raises(RepositoryError) as caught:
        list(iterator)
    assert "private-password" not in str(caught.value)
    session.__exit__.assert_called_once()


@pytest.mark.parametrize("options", [{"batch_size": 0}, {"batch_size": True}, {"batch_size": 1001},
                                     {"start_time": NOW, "end_time": NOW - timedelta(seconds=1)},
                                     {"start_time": NOW.replace(tzinfo=None)}])
def test_repository_rejects_invalid_pagination_or_time_inputs_before_connection(tmp_path, options):
    factory = Mock()
    with pytest.raises(ValueError):
        FrameRepository(factory, tmp_path).iter_search_candidates(SESSION, now=NOW, **options)
    factory.assert_not_called()


@pytest.mark.parametrize("options", [{"default_limit": 21}, {"latest_seconds": 121}, {"batch_size": 1001},
                                     {"min_similarity": 1.1}, {"min_similarity": float("nan")},
                                     {"ocr_boost": -0.1}, {"max_limit": True}])
def test_invalid_search_configuration(options):
    with pytest.raises(SearchConfigurationError):
        SearchSettings(**options)


def test_config_file_and_environment_precedence(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("SEARCH_DEFAULT_LIMIT=3\nSEARCH_MIN_SIMILARITY=0.6\nSEARCH_OCR_BOOST=0.2\n", encoding="utf-8")
    monkeypatch.setattr(module, "ENV_FILE", path)
    monkeypatch.setenv("SEARCH_DEFAULT_LIMIT", "4")
    settings = SearchSettings.from_env()
    assert settings.default_limit == 4 and settings.min_similarity == 0.6 and settings.ocr_boost == 0.2
    monkeypatch.setenv("SEARCH_BATCH_SIZE", "not-a-number")
    with pytest.raises(SearchConfigurationError):
        SearchSettings.from_env()


def test_cli_offline_demo_outputs_actual_contract_json(capsys):
    assert main(["--offline-demo", "--query", "classroom door", "--session-id", str(SESSION), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert ids(result)[0] == 1 and len(result["frames"]) == 3


def test_cli_normal_mode_uses_injected_real_boundaries(capsys):
    repository, embedding = FakeRepository([candidate()]), FakeEmbeddings()
    factory = lambda repo, embed, **kwargs: SearchService(repo, embed, settings=SearchSettings(), clock=lambda: NOW)
    with patch("database.connection.Database"), patch("database.repository.FrameRepository.from_database", return_value=repository), \
            patch("processing.embedding_service.EmbeddingService", return_value=embedding), patch.object(module, "SearchService", factory):
        assert main(["--query", "door", "--session-id", str(SESSION)]) == 0
    assert "Matching frames: 1" in capsys.readouterr().out
    assert embedding.calls == ["door"]


@pytest.mark.parametrize("arguments, expected", [
    (["--session-id", "invalid", "--query", "door"], 1),
    (["--session-id", str(SESSION), "--query", "door", "--limit", "0"], 1),
    (["--session-id", str(SESSION), "--query", "door", "--min-similarity", "nan"], 1),
])
def test_cli_invalid_values_never_configure_real_database(arguments, expected):
    with patch("database.connection.Database", side_effect=AssertionError("No database for invalid input")):
        assert main(arguments) == expected


def test_cli_invalid_mode_is_parser_error():
    with pytest.raises(SystemExit) as caught:
        main(["--query", "door", "--session-id", str(SESSION), "--mode", "wrong"])
    assert caught.value.code == 2


def test_imports_and_offline_cli_do_not_connect_or_create_openai_client():
    code = ("from unittest.mock import patch\n"
            "with patch('pymysql.connect', side_effect=AssertionError('Unexpected MySQL')), "
            "patch('openai.OpenAI', side_effect=AssertionError('Unexpected OpenAI')):\n"
            "    import api.search_service\n"
            "    from api.app.search_service import SearchService\n"
            f"    assert api.search_service.main(['--offline-demo','--query','classroom door','--session-id','{SESSION}']) == 0\n")
    child = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30,
                           cwd=Path(__file__).resolve().parents[1])
    assert child.returncode == 0, child.stderr
