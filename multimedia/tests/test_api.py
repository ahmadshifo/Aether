"""Offline HTTP, authorization, mapping and resource-lifecycle tests for Task 12."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID

from fastapi.testclient import TestClient
import httpx
import jwt
import pymysql
import pytest

from api.dependencies import get_database, get_embedding_service, get_repository, get_search_service, get_search_settings
from api.main import create_app
from api.routes import public_metadata
from api.search_service import SearchEmbeddingError, SearchRepositoryError, SearchSettings
from api.security import ACCESS_COOKIE, REFRESH_COOKIE, get_principal
from api.settings import ApiSettings
from database.errors import DatabaseConnectionError, ImageStorageError, RepositoryError
from database.repository import FrameRecord, FrameRepository
from processing.embedding_service import DEFAULT_MODEL, EmbeddingResult

NOW = datetime(2026, 11, 6, 10, 30, tzinfo=UTC)
SESSION, OTHER_SESSION = UUID(int=1001), UUID(int=1002)
USER, OTHER_USER = UUID(int=2001), UUID(int=2002)
SECRET = "synthetic-only-jwt-signing-secret-at-least-32-bytes"
ORIGIN = "http://localhost:5174"
JPEG = b"\xff\xd8synthetic-stored-jpeg-bytes\xff\xd9"


def row(identifier=1, age=2, **changes):
    vector = [1.0] + [0.0] * 1535
    result = FrameRecord(UUID(int=identifier), SESSION, NOW - timedelta(seconds=age), 30, 1000,
                         f"{SESSION}/{UUID(int=identifier)}.jpg", "ROOM 205", ["door", "sign"],
                         "A classroom door.", vector, DEFAULT_MODEL, NOW, NOW + timedelta(hours=24))
    return replace(result, **changes)


def wire(frame=None, score=0.8):
    return {**public_metadata(row() if frame is None else frame).model_dump(mode="json"), "relevance_score": score}


class FakeRepository:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.owners = {SESSION: USER, OTHER_SESSION: OTHER_USER}
        self.account_ids = {USER, OTHER_USER}
        self.get_frame = Mock(side_effect=lambda identifier: next((item for item in self.rows if item.frame_id == identifier), None))
        self.load_frame_image = Mock(return_value=JPEG)
        self.refresh_user = USER
        self.get_refresh_user = Mock(side_effect=lambda *args, **kwargs: self.refresh_user)
        self.has_account = Mock(side_effect=lambda user: user in self.account_ids)
        self.list_timeline_frames = Mock(side_effect=self._timeline)

    def session_owned_by(self, session, user):
        return self.owners.get(session) == user

    def _timeline(self, session, limit, *, before, now):
        rows = [item for item in self.rows if item.session_id == session and item.expires_at > now and item.captured_at <= now]
        if before is not None:
            rows = [item for item in rows if (item.captured_at, item.frame_id.int) < (before.captured_at, before.frame_id.int)]
        return sorted(rows, key=lambda item: (item.captured_at, item.frame_id.int), reverse=True)[:limit]

    def iter_search_candidates(self, session_id, start_time=None, end_time=None, *, now, batch_size=128):
        return (item for item in self.rows if item.session_id == session_id and item.expires_at > now
                and (start_time is None or item.captured_at >= start_time)
                and (end_time is None or item.captured_at <= end_time))


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    def forbid(*args, **kwargs):
        pytest.fail("API unit tests must not contact MySQL or external HTTP")
    monkeypatch.setattr(pymysql, "connect", forbid)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid)
    from api import search_service
    monkeypatch.setattr(search_service, "ENV_FILE", tmp_path / "absent.env")
    for suffix in ("LATEST_SECONDS", "RECENT_SECONDS", "DEFAULT_LIMIT", "MAX_LIMIT", "BATCH_SIZE", "MIN_SIMILARITY", "OCR_BOOST"):
        monkeypatch.delenv("SEARCH_" + suffix, raising=False)


@pytest.fixture
def configured():
    repository = FakeRepository([row()])
    search = Mock()
    search.search.return_value = {"frames": [wire()]}
    app = create_app(ApiSettings(jwt_secret=SECRET, cors_origins=(ORIGIN,)), clock=lambda: NOW)
    app.dependency_overrides[get_repository] = lambda: repository
    app.dependency_overrides[get_search_service] = lambda: search
    app.dependency_overrides[get_principal] = lambda: USER
    with TestClient(app, raise_server_exceptions=False) as client:
        yield app, client, repository, search


def payload(**changes):
    return {"session_id": str(SESSION), "query": "What was written on the classroom door?", "mode": "recent", "limit": 5, **changes}


def access_token(user=USER, **changes):
    return jwt.encode({"sub": str(user), "typ": "access", "iat": int(time.time()), "exp": int(time.time()) + 600, **changes}, SECRET, algorithm="HS256")


def test_application_metadata_docs_openapi_and_only_agreed_paths(configured):
    app, client, _, _ = configured
    assert app.title == "Aether Multimedia API" and app.version == "1.0.0"
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    # /api/v1/frames/keep: contract addition 2026-11-08 (docs/decision-log.md), saves the frames an answer used.
    assert set(schema["paths"]) == {"/health", "/api/v1/search", "/api/v1/frames", "/api/v1/frames/{frame_id}/image",
                                    "/api/v1/frames/keep"}
    assert "ExistingAccessCookie" in schema["components"]["securitySchemes"]
    assert schema["paths"]["/api/v1/frames"]["get"]["parameters"][1]["schema"]["maximum"] == 100


def test_liveness_is_independent_of_database_keys_and_search(configured):
    app, client, _, search = configured
    def fail():
        raise AssertionError("Health must not access data")
    app.dependency_overrides[get_repository] = fail
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "aether-multimedia", "version": "1.0.0"}
    search.search.assert_not_called()
    assert app.state.database is None


@pytest.mark.parametrize("mode", ["latest", "recent", "history"])
def test_search_forwards_valid_request_once_and_preserves_metadata(configured, mode):
    _, client, _, search = configured
    response = client.post("/api/v1/search", json=payload(mode=mode))
    assert response.status_code == 200
    assert response.json() == {"frames": [wire()]}
    search.search.assert_called_once_with(session_id=SESSION, query=payload()["query"], mode=mode, limit=5)
    frame = response.json()["frames"][0]
    assert frame["timestamp"] == frame["captured_at"]
    assert frame["image_url"] == f"/api/v1/frames/{row().frame_id}/image"
    assert not {"embedding", "embedding_model", "image_path"} & frame.keys()


def test_empty_search_and_service_rank_order(configured):
    _, client, _, search = configured
    search.search.return_value = {"frames": []}
    assert client.post("/api/v1/search", json=payload()).json() == {"frames": []}
    search.search.return_value = {"frames": [wire(row(3), 0.9), wire(row(1), 0.3)]}
    assert [item["frame_id"] for item in client.post("/api/v1/search", json=payload()).json()["frames"]] == [str(UUID(int=3)), str(UUID(int=1))]


@pytest.mark.parametrize("changes, field", [
    ({"session_id": "bad"}, "session_id"), ({"query": ""}, "query"), ({"query": " \n "}, "query"),
    ({"query": 42}, "query"), ({"query": "?!..."}, "query"), ({"mode": "wrong"}, "mode"), ({"limit": 0}, "limit"),
    ({"limit": -1}, "limit"), ({"limit": 21}, "limit"), ({"limit": 1.5}, "limit"),
    ({"limit": "5"}, "limit"), ({"limit": True}, "limit"), ({"limit": None}, "limit"),
])
def test_search_validation_happens_before_service(configured, changes, field):
    _, client, _, search = configured
    response = client.post("/api/v1/search", json=payload(**changes))
    assert response.status_code == 422 and field in response.json()["error"]["fields"]
    search.search.assert_not_called()


def test_malformed_json_missing_fields_and_unagreed_fields_are_rejected(configured):
    _, client, _, search = configured
    assert client.post("/api/v1/search", content="{bad", headers={"Content-Type": "application/json"}).status_code == 422
    assert client.post("/api/v1/search", json={}).status_code == 422
    assert client.post("/api/v1/search", json=payload(private_path="secret")).status_code == 422
    search.search.assert_not_called()


def test_search_limit_is_required_by_shared_contract_and_timeline_has_its_default(configured):
    _, client, _, search = configured
    body = payload()
    del body["limit"]
    assert client.post("/api/v1/search", json=body).status_code == 422
    search.search.assert_not_called()


def test_configured_lower_search_maximum_is_422_instead_of_internal_error(configured):
    app, client, _, search = configured
    app.dependency_overrides[get_search_settings] = lambda: SearchSettings(default_limit=2, max_limit=2)
    response = client.post("/api/v1/search", json=payload(limit=3))
    assert response.status_code == 422
    search.search.assert_not_called()


@pytest.mark.parametrize("error,status", [(SearchRepositoryError("mysql-secret"), 503),
                                         (DatabaseConnectionError("mysql-secret"), 503),
                                         (SearchEmbeddingError("api-secret"), 502),
                                         (RuntimeError("private-path-secret"), 500)])
def test_failures_are_controlled_without_secret_messages(configured, error, status, caplog):
    _, client, _, search = configured
    search.search.side_effect = error
    response = client.post("/api/v1/search", json=payload(), headers={"Origin": ORIGIN})
    assert response.status_code == status and "secret" not in response.text and "secret" not in caplog.text
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("changes", [{"relevance_score": float("nan")}, {"relevance_score": 1.1},
                                     {"relevance_score": True}, {"timestamp": "2026-11-06T10:00:00"},
                                     {"timestamp": 0, "captured_at": 0},
                                     {"captured_at": "2026-11-06T10:00:00Z"}, {"image_path": "private.jpg"},
                                     {"embedding": [1.0]}, {"image_url": "C:/private.jpg"},
                                     {"session_id": str(OTHER_SESSION)}])
def test_bad_service_mapping_is_a_safe_server_error_not_silently_hidden(configured, changes):
    _, client, _, search = configured
    search.search.return_value = {"frames": [{**wire(), **changes}]}
    response = client.post("/api/v1/search", json=payload())
    assert response.status_code == 500
    assert "private.jpg" not in response.text and "embedding" not in response.text


def test_response_limit_violation_is_not_reported_as_success(configured):
    _, client, _, search = configured
    search.search.return_value = {"frames": [wire(row(1)), wire(row(2))]}
    assert client.post("/api/v1/search", json=payload(limit=1)).status_code == 500


def test_timeline_empty_and_default_limit_without_ai_or_images(configured):
    _, client, repository, search = configured
    response = client.get("/api/v1/frames", params={"session_id": str(SESSION)})
    assert response.status_code == 200
    assert response.json() == {"frames": [public_metadata(row()).model_dump(mode="json")], "next_cursor": None}
    repository.list_timeline_frames.assert_called_once_with(SESSION, 21, before=None, now=NOW)
    repository.load_frame_image.assert_not_called()
    search.search.assert_not_called()
    repository.rows.clear()
    assert client.get("/api/v1/frames", params={"session_id": str(SESSION)}).json() == {"frames": [], "next_cursor": None}


def test_timeline_filters_expired_other_sessions_future_and_sorts_stably(configured):
    _, client, repository, _ = configured
    repository.list_timeline_frames.side_effect = None
    repository.list_timeline_frames.return_value = [row(1, age=20), row(3, age=10), row(2, age=10),
                                                   row(4, expires_at=NOW), row(5, session_id=OTHER_SESSION), row(6, age=-1)]
    response = client.get("/api/v1/frames", params={"session_id": str(SESSION)})
    assert [item["frame_id"] for item in response.json()["frames"]] == [str(UUID(int=i)) for i in (3, 2, 1)]


@pytest.mark.parametrize("parameters", [{}, {"session_id": "wrong"}, {"session_id": str(SESSION), "limit": 0},
                                        {"session_id": str(SESSION), "limit": 101}, {"session_id": str(SESSION), "limit": "2.0"},
                                        {"session_id": str(SESSION), "limit": "true"}, {"session_id": str(SESSION), "cursor": "bad"}])
def test_timeline_invalid_parameters(configured, parameters):
    _, client, repository, _ = configured
    assert client.get("/api/v1/frames", params=parameters).status_code == 422
    repository.list_timeline_frames.assert_not_called()


def test_cursor_pagination_continues_after_deletion_and_binds_session(configured):
    _, client, repository, _ = configured
    repository.rows = [row(1), row(3), row(2)]
    first = client.get("/api/v1/frames", params={"session_id": str(SESSION), "limit": 1}).json()
    assert first["frames"][0]["frame_id"] == str(UUID(int=3)) and first["next_cursor"]
    repository.rows = [item for item in repository.rows if item.frame_id != UUID(int=3)]
    second = client.get("/api/v1/frames", params={"session_id": str(SESSION), "limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["frames"][0]["frame_id"] == str(UUID(int=2))
    repository.owners[OTHER_SESSION] = USER
    mismatch = client.get("/api/v1/frames", params={"session_id": str(OTHER_SESSION), "cursor": first["next_cursor"]})
    assert mismatch.status_code == 422


def test_timeline_database_error_and_session_access_failure(configured):
    _, client, repository, _ = configured
    assert client.get("/api/v1/frames", params={"session_id": str(OTHER_SESSION)}).status_code == 404
    repository.list_timeline_frames.side_effect = RepositoryError("password=secret")
    response = client.get("/api/v1/frames", params={"session_id": str(SESSION)})
    assert response.status_code == 503 and "secret" not in response.text


def test_stored_jpeg_bytes_media_type_and_private_cache_headers(configured):
    _, client, repository, search = configured
    response = client.get(f"/api/v1/frames/{row().frame_id}/image")
    assert response.status_code == 200 and response.content == JPEG
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    repository.load_frame_image.assert_called_once_with(row().frame_id)
    search.search.assert_not_called()
    assert "image_path" not in response.headers


@pytest.mark.parametrize("kind", ["unknown", "expired", "other-session", "missing-file", "missing-bytes"])
def test_unavailable_images_are_404_without_leaking_paths(configured, kind):
    _, client, repository, _ = configured
    identifier = row().frame_id
    if kind == "unknown":
        identifier = UUID(int=99)
    elif kind == "expired":
        repository.rows = [row(expires_at=NOW)]
    elif kind == "other-session":
        repository.rows = [row(session_id=OTHER_SESSION)]
    elif kind == "missing-file":
        repository.load_frame_image.side_effect = ImageStorageError("C:/private/frame.jpg")
    else:
        repository.load_frame_image.return_value = None
    response = client.get(f"/api/v1/frames/{identifier}/image")
    assert response.status_code == 404 and "C:/private" not in response.text
    if kind in ("unknown", "expired", "other-session"):
        repository.load_frame_image.assert_not_called()


def test_image_rechecks_expiration_after_file_read(configured):
    app, client, _, _ = configured
    app.state.clock = Mock(side_effect=[NOW, NOW + timedelta(hours=25)])
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 404


def test_invalid_uuid_and_path_traversal_never_read_files(configured):
    _, client, repository, _ = configured
    assert client.get("/api/v1/frames/not-a-uuid/image").status_code == 422
    assert client.get("/api/v1/frames/..%2F..%2Fprivate/image").status_code in (404, 422)
    repository.load_frame_image.assert_not_called()


def test_real_repository_path_guards_remain_in_effect_at_http_boundary(configured, tmp_path):
    app, client, _, _ = configured
    repository = FrameRepository(Mock(), tmp_path / "managed")
    repository.get_frame = Mock(return_value=row(image_path="../../outside-secret.jpg"))
    repository.session_owned_by = Mock(return_value=True)
    app.dependency_overrides[get_repository] = lambda: repository
    response = client.get(f"/api/v1/frames/{row().frame_id}/image")
    assert response.status_code == 404 and "outside-secret" not in response.text


def test_jpeg_database_failure_is_503(configured):
    _, client, repository, _ = configured
    repository.get_frame.side_effect = RepositoryError("mysql-password")
    response = client.get(f"/api/v1/frames/{row().frame_id}/image")
    assert response.status_code == 503 and "mysql-password" not in response.text


@pytest.mark.parametrize("origin, allowed", [(ORIGIN, True), ("https://unapproved.example", False)])
def test_cors_simple_and_preflight(configured, origin, allowed):
    _, client, _, _ = configured
    simple = client.get("/health", headers={"Origin": origin})
    assert (simple.headers.get("access-control-allow-origin") == origin) == allowed
    preflight = client.options("/api/v1/search", headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})
    assert preflight.status_code == (200 if allowed else 400)
    assert (preflight.headers.get("access-control-allow-origin") == origin) == allowed
    if allowed:
        assert preflight.headers["access-control-allow-credentials"] == "true"


def test_validation_errors_do_not_echo_secret_input_or_unknown_field_names(configured):
    _, client, _, _ = configured
    response = client.post("/api/v1/search", json=payload(mode="sk-private-password-123456"))
    assert response.status_code == 422 and "sk-private-password" not in response.text
    response = client.post("/api/v1/search", json={**payload(), "sensitive-secret-key": "private-password"})
    assert response.status_code == 422 and "sensitive-secret-key" not in response.text and "private-password" not in response.text


def test_no_anonymous_access_or_uuid_only_authorization(configured):
    app, client, repository, _ = configured
    del app.dependency_overrides[get_principal]
    for url in (f"/api/v1/frames/{row().frame_id}/image", f"/api/v1/frames?session_id={SESSION}"):
        assert client.get(url).status_code == 401
    assert client.post("/api/v1/search", json=payload()).status_code == 401
    repository.get_frame.assert_not_called()


def test_existing_signed_access_cookie_authenticates_and_checks_account(configured):
    app, client, repository, _ = configured
    del app.dependency_overrides[get_principal]
    client.cookies.set(ACCESS_COOKIE, access_token())
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 200
    repository.has_account.assert_called_once_with(USER)
    repository.account_ids.clear()
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 401


@pytest.mark.parametrize("kind", ["expired", "tampered", "wrong-type", "wrong-user", "bad-subject"])
def test_auth_rejects_invalid_tokens_or_other_users(configured, kind):
    app, client, _, _ = configured
    del app.dependency_overrides[get_principal]
    token = access_token()
    if kind == "expired":
        token = access_token(exp=int(time.time()) - 60)
    elif kind == "tampered":
        token = jwt.encode({"sub": str(USER), "typ": "access", "exp": int(time.time()) + 60}, "different-secret-at-least-32-characters", algorithm="HS256")
    elif kind == "wrong-type":
        token = access_token(typ="refresh")
    elif kind == "bad-subject":
        token = access_token(sub="not-a-uuid")
    else:
        token = access_token(OTHER_USER)
    client.cookies.set(ACCESS_COOKIE, token)
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == (404 if kind == "wrong-user" else 401)


def test_existing_refresh_cookie_uses_hash_and_expiration_lookup_read_only(configured):
    app, client, repository, _ = configured
    del app.dependency_overrides[get_principal]
    client.cookies.set(REFRESH_COOKIE, "synthetic-refresh-token")
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 200
    repository.get_refresh_user.assert_called_once_with(hashlib.sha256(b"synthetic-refresh-token").hexdigest(), now=NOW, max_age=timedelta(days=7))
    repository.refresh_user = None
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 401


def test_missing_shared_jwt_configuration_fails_closed(configured):
    app, client, _, _ = configured
    del app.dependency_overrides[get_principal]
    app.state.settings = ApiSettings(jwt_secret=None)
    client.cookies.set(ACCESS_COOKIE, access_token())
    assert client.get(f"/api/v1/frames/{row().frame_id}/image").status_code == 503


def test_actual_task11_service_and_task10_record_shape_are_reused(configured):
    app, client, repository, search = configured
    del app.dependency_overrides[get_search_service]
    embedding = Mock()
    embedding.model = DEFAULT_MODEL
    embedding.embed_query.return_value = EmbeddingResult(DEFAULT_MODEL, 1536, "door", row().embedding)
    app.dependency_overrides[get_embedding_service] = lambda: embedding
    repository.rows = [row(1), row(2, age=1000), row(3, session_id=OTHER_SESSION), row(4, expires_at=NOW)]
    response = client.post("/api/v1/search", json=payload())
    assert response.status_code == 200 and [frame["frame_id"] for frame in response.json()["frames"]] == [str(row().frame_id)]
    embedding.embed_query.assert_called_once_with(payload()["query"])
    search.search.assert_not_called()


def test_one_lazy_database_per_application_and_disposal_on_shutdown():
    app = create_app(ApiSettings())
    database = Mock()
    request = SimpleNamespace(app=app)
    with patch("api.dependencies.Database", return_value=database) as factory:
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
            factory.assert_not_called()
            assert get_database(request) is get_database(request) is database
            factory.assert_called_once_with()
    database.close.assert_called_once()
    assert app.state.database is None


@pytest.mark.parametrize("origins", [("*",), ("http://*",), ("https://user:private@example.com",), ("http://localhost/path",), ("http://localhost:99999",)])
def test_unsafe_cors_settings_rejected(origins):
    with pytest.raises(ValueError):
        ApiSettings(cors_origins=origins)


def test_http_config_uses_env_over_file_and_reads_existing_private_auth_secret(tmp_path, monkeypatch):
    from api import settings as settings_module
    own, auth = tmp_path / "api.env", tmp_path / "auth.env"
    own.write_text("API_PORT=8000\nAPI_CORS_ORIGINS=http://localhost:5174\n", encoding="utf-8")
    auth.write_text("JWT_SECRET='synthetic secret with spaces'\nAUTH_MAX_DAYS=5\n", encoding="utf-8")
    monkeypatch.setattr(settings_module, "ENV_FILE", own)
    monkeypatch.setattr(settings_module, "AUTH_ENV_FILE", auth)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("AUTH_MAX_DAYS", raising=False)
    monkeypatch.setenv("API_PORT", "8005")
    value = ApiSettings.from_env()
    assert value.port == 8005 and value.cors_origins == (ORIGIN,)
    assert value.jwt_secret == "synthetic secret with spaces" and value.refresh_max_days == 5
    assert "synthetic secret" not in repr(value)


def test_application_import_and_legacy_alias_need_no_database_or_api_credentials():
    code = ("import os\nfrom unittest.mock import patch\n"
            "os.environ['DATABASE_URL']=''\nos.environ['OPENAI_API_KEY']=''\n"
            "with patch('database.connection.Database', side_effect=AssertionError('No database construction')), "
            "patch('openai.OpenAI', side_effect=AssertionError('No AI client')):\n"
            "    from api.main import app\n    from api.app.main import app as legacy\n"
            "    assert app is legacy and app.state.database is None\n    print(app.title)\n")
    child = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30,
                           cwd=Path(__file__).resolve().parents[1])
    assert child.returncode == 0, child.stderr
    assert child.stdout.strip() == "Aether Multimedia API"
