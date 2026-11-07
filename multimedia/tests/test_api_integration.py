"""Real HTTP-to-MySQL Task 12 tests, using existing login cookies and fake query vectors."""

from datetime import UTC, datetime, timedelta
import importlib
import os
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID, uuid4

import cv2
from fastapi.testclient import TestClient
import numpy as np
import pytest
from sqlalchemy import update, text

from api.dependencies import get_embedding_service, get_repository
from api.main import create_app
from api.security import ACCESS_COOKIE, REFRESH_COOKIE
from api.settings import ApiSettings
from database.connection import Database
from database.errors import DatabaseConnectionError
from database.models import Frame, LoginSession, StreamSession
from database.repository import FrameRepository
from processing.embedding_service import DEFAULT_MODEL, EmbeddingResult

pytestmark = pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1",
                                reason="Set RUN_MYSQL_TESTS=1 for real MySQL HTTP integration tests")


@pytest.fixture(scope="module")
def shared_backend():
    patcher = pytest.MonkeyPatch()
    patcher.syspath_prepend(str(Path(__file__).resolve().parents[2] / "web" / "ai-backend"))
    settings = ApiSettings.from_env()
    if not settings.jwt_secret:
        raise RuntimeError("Real API integration needs the existing account backend JWT_SECRET configured privately.")
    with Database() as database:
        database.check()
        url = database.settings.url
        for key, value in {"MYSQL_HOST": url.host, "MYSQL_PORT": str(url.port or 3306), "MYSQL_USER": url.username,
                           "MYSQL_PASSWORD": url.password, "MYSQL_DATABASE": url.database, "JWT_SECRET": settings.jwt_secret}.items():
            patcher.setenv(key, value)
        backend = importlib.import_module("app.main")
        try:
            yield database, backend.app, settings
        finally:
            patcher.undo()


@pytest.fixture
def stored(shared_backend, tmp_path):
    database, auth_app, settings = shared_backend
    repository = FrameRepository(database.sessions, tmp_path / "jpeg_storage")
    frame_ids, emails = [], []
    session_a, session_b, empty_session = uuid4(), uuid4(), uuid4()
    cookies = []
    users = []
    try:
        with TestClient(auth_app) as auth_client:
            for _ in range(2):
                email = f"aether-api-test-{uuid4().hex}@example.invalid"
                emails.append(email)
                response = auth_client.post("/api/v1/auth/signup", json={
                    "name": "Synthetic API Test", "email": email, "password": "Synthetic-API-Password-42!"})
                assert response.status_code == 201, response.text
                users.append(UUID(response.json()["user"]["user_id"]))
                cookies.append({key: auth_client.cookies.get(key) for key in (ACCESS_COOKIE, REFRESH_COOKIE)})
        now = datetime.now(UTC)
        with database.sessions.begin() as sql_session:
            sql_session.add_all([StreamSession(session_id=session_a, user_id=users[0], status="live", started_at=now),
                                 StreamSession(session_id=session_b, user_id=users[1], status="live", started_at=now),
                                 StreamSession(session_id=empty_session, user_id=users[0], status="ended", started_at=now)])
        vector = [1.0] + [0.0] * 1535
        image = np.full((24, 32, 3), 155, dtype=np.uint8)

        def save(age=2, session_id=None, embedding=None, **kwargs):
            identifier = uuid4()
            frame_ids.append(identifier)
            return repository.save_frame(session_a if session_id is None else session_id,
                kwargs.pop("captured_at", now - timedelta(seconds=age)), image,
                frame_id=identifier, ocr_text=kwargs.pop("ocr_text", "ROOM 205"),
                objects=kwargs.pop("objects", ["door", "sign"]), caption=kwargs.pop("caption", "Synthetic classroom door."),
                embedding=vector if embedding is None else embedding, embedding_model=DEFAULT_MODEL, **kwargs)

        embedding = Mock()
        embedding.model = DEFAULT_MODEL
        embedding.embed_query.return_value = EmbeddingResult(DEFAULT_MODEL, 1536, "door", vector)
        app = create_app(settings, clock=lambda: now)
        app.dependency_overrides[get_repository] = lambda: repository
        app.dependency_overrides[get_embedding_service] = lambda: embedding
        with TestClient(app, raise_server_exceptions=False) as client:
            client.cookies.update(cookies[0])
            yield dict(database=database, repository=repository, save=save, client=client, app=app,
                       sessions=(session_a, session_b, empty_session), users=users, cookies=cookies,
                       now=now, embedding=embedding, image=image)
    finally:
        for identifier in frame_ids:
            repository.delete_frame(identifier)
        with database.engine.begin() as connection:
            for identifier in (session_a, session_b, empty_session):
                connection.execute(text("DELETE FROM sessions WHERE session_id = :id"), {"id": str(identifier)})
            for email in emails:
                connection.execute(text("DELETE FROM users WHERE email = :email"), {"email": email})


def search_body(stored, **changes):
    return {"session_id": str(stored["sessions"][0]), "query": "classroom door", "mode": "recent", "limit": 5, **changes}


def test_actual_mysql_health_docs_and_wire_contract(stored):
    client = stored["client"]
    assert stored["database"].check()["mysql_version"].startswith(("8.0.", "8.4."))
    assert client.get("/health").json() == {"status": "ok", "service": "aether-multimedia", "version": "1.0.0"}
    assert client.get("/docs").status_code == 200
    assert len(client.get("/openapi.json").json()["paths"]) == 4
    stored["embedding"].embed_query.assert_not_called()


def test_timeline_uses_real_repository_metadata_and_order(stored):
    older, newer = stored["save"](60), stored["save"](2)
    response = stored["client"].get("/api/v1/frames", params={"session_id": str(stored["sessions"][0])})
    assert response.status_code == 200
    body = response.json()
    assert [frame["frame_id"] for frame in body["frames"]] == [str(newer), str(older)]
    assert body["next_cursor"] is None
    assert body["frames"][0]["ocr_text"] == "ROOM 205" and body["frames"][0]["objects"] == ["door", "sign"]
    assert body["frames"][0]["timestamp"] == body["frames"][0]["captured_at"]
    assert "image_path" not in body["frames"][0] and "embedding" not in body["frames"][0]
    stored["embedding"].embed_query.assert_not_called()


def test_jpeg_download_matches_real_saved_bytes_and_decodes(stored):
    identifier = stored["save"]()
    response = stored["client"].get(f"/api/v1/frames/{identifier}/image")
    assert response.status_code == 200
    assert response.content == stored["repository"].load_frame_image(identifier)
    decoded = cv2.imdecode(np.frombuffer(response.content, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == stored["image"].shape
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, no-store"
    stored["embedding"].embed_query.assert_not_called()


def test_search_calls_real_task11_over_real_mysql_with_one_fake_query(stored):
    weaker = [0.0, 1.0] + [0.0] * 1534
    stored["save"](2, embedding=weaker, ocr_text="", objects=["laptop"], caption="A laptop.")
    door = stored["save"](30)
    response = stored["client"].post("/api/v1/search", json=search_body(stored))
    assert response.status_code == 200 and response.json()["frames"][0]["frame_id"] == str(door)
    assert response.json()["frames"][0]["relevance_score"] > response.json()["frames"][1]["relevance_score"]
    stored["embedding"].embed_query.assert_called_once_with("classroom door")


def test_latest_has_ten_second_filter_without_embedding_calls(stored):
    fresh = stored["save"](3)
    stored["save"](30)
    response = stored["client"].post("/api/v1/search", json=search_body(stored, mode="latest"))
    assert response.status_code == 200
    assert [frame["frame_id"] for frame in response.json()["frames"]] == [str(fresh)]
    stored["embedding"].embed_query.assert_not_called()


def test_existing_backend_cookies_and_account_ownership_isolate_sessions(stored):
    first = stored["save"]()
    other = stored["save"](session_id=stored["sessions"][1])
    client = stored["client"]
    assert client.get(f"/api/v1/frames/{first}/image").status_code == 200
    assert client.get(f"/api/v1/frames/{other}/image").status_code == 404
    assert client.get("/api/v1/frames", params={"session_id": str(stored["sessions"][1])}).status_code == 404
    assert client.post("/api/v1/search", json=search_body(stored, session_id=str(stored["sessions"][1]))).status_code == 404
    client.cookies.clear()
    client.cookies.update(stored["cookies"][1])
    assert client.get(f"/api/v1/frames/{first}/image").status_code == 404
    assert client.get(f"/api/v1/frames/{other}/image").status_code == 200


def test_expired_frames_excluded_from_all_three_private_endpoints(stored):
    expired, valid = stored["save"](), stored["save"]()
    now = stored["now"]
    with stored["database"].engine.begin() as connection:
        connection.execute(update(Frame).where(Frame.frame_id == expired).values(
            created_at=now - timedelta(hours=2), expires_at=now - timedelta(seconds=1)))
    client = stored["client"]
    assert client.get(f"/api/v1/frames/{expired}/image").status_code == 404
    timeline = client.get("/api/v1/frames", params={"session_id": str(stored["sessions"][0])}).json()
    assert [frame["frame_id"] for frame in timeline["frames"]] == [str(valid)]
    assert [frame["frame_id"] for frame in client.post("/api/v1/search", json=search_body(stored)).json()["frames"]] == [str(valid)]


def test_authorized_empty_session_returns_successful_empty_results(stored):
    client = stored["client"]
    empty = str(stored["sessions"][2])
    timeline = client.get("/api/v1/frames", params={"session_id": empty})
    search = client.post("/api/v1/search", json=search_body(stored, session_id=empty))
    assert timeline.status_code == search.status_code == 200
    assert timeline.json() == {"frames": [], "next_cursor": None} and search.json() == {"frames": []}
    stored["embedding"].embed_query.assert_not_called()


def test_pagination_is_stable_across_deleted_cursor_record(stored):
    identifiers = [stored["save"]() for _ in range(3)]
    expected = sorted(identifiers, reverse=True)
    client, session = stored["client"], str(stored["sessions"][0])
    first = client.get("/api/v1/frames", params={"session_id": session, "limit": 1}).json()
    assert first["frames"][0]["frame_id"] == str(expected[0])
    stored["repository"].delete_frame(expected[0])
    second = client.get("/api/v1/frames", params={"session_id": session, "limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["frames"][0]["frame_id"] == str(expected[1])


def test_missing_physical_file_is_safe_404(stored):
    identifier = stored["save"]()
    record = stored["repository"].get_frame(identifier)
    (stored["repository"].storage_root / record.image_path).unlink()
    response = stored["client"].get(f"/api/v1/frames/{identifier}/image")
    assert response.status_code == 404 and record.image_path not in response.text


def test_invalid_parameters_and_unknown_frame_are_safe(stored):
    client = stored["client"]
    assert client.post("/api/v1/search", json=search_body(stored, query="")).status_code == 422
    assert client.post("/api/v1/search", json=search_body(stored, mode="bad")).status_code == 422
    assert client.get("/api/v1/frames", params={"session_id": "bad"}).status_code == 422
    assert client.get("/api/v1/frames", params={"session_id": str(stored["sessions"][0]), "limit": 101}).status_code == 422
    assert client.get(f"/api/v1/frames/{uuid4()}/image").status_code == 404


def test_database_outage_is_503_but_health_remains_200(stored):
    def unavailable():
        raise DatabaseConnectionError("mysql-password-private")
    stored["app"].dependency_overrides[get_repository] = unavailable
    response = stored["client"].get("/api/v1/frames", params={"session_id": str(stored["sessions"][0])})
    assert response.status_code == 503 and "mysql-password-private" not in response.text
    assert stored["client"].get("/health").status_code == 200


def test_refresh_cookie_from_real_login_session_and_no_anonymous_access(stored):
    identifier = stored["save"]()
    client = stored["client"]
    client.cookies.delete(ACCESS_COOKIE)
    assert client.get(f"/api/v1/frames/{identifier}/image").status_code == 200
    client.cookies.clear()
    assert client.get(f"/api/v1/frames/{identifier}/image").status_code == 401


@pytest.mark.parametrize("expired", [True, False])
def test_expired_or_over_age_refresh_session_is_rejected(stored, expired):
    identifier = stored["save"]()
    now = stored["now"]
    with stored["database"].engine.begin() as connection:
        connection.execute(update(LoginSession).where(LoginSession.user_id == stored["users"][0]).values(
            created_at=now - timedelta(days=8) if not expired else now - timedelta(hours=2),
            expires_at=now + timedelta(hours=1) if not expired else now - timedelta(hours=1)))
    stored["client"].cookies.delete(ACCESS_COOKIE)
    assert stored["client"].get(f"/api/v1/frames/{identifier}/image").status_code == 401


def test_cursor_cannot_be_reused_for_another_owned_session(stored):
    stored["save"]()
    stored["save"]()
    client = stored["client"]
    cursor = client.get("/api/v1/frames", params={"session_id": str(stored["sessions"][0]), "limit": 1}).json()["next_cursor"]
    assert client.get("/api/v1/frames", params={"session_id": str(stored["sessions"][2]), "cursor": cursor}).status_code == 422


def test_default_app_uses_one_real_lazy_engine_without_repository_override(stored, shared_backend):
    stored["save"]()
    app = create_app(shared_backend[2], clock=lambda: stored["now"])
    with TestClient(app) as client:
        client.cookies.update(stored["cookies"][0])
        assert client.get("/health").status_code == 200 and app.state.database is None
        parameters = {"session_id": str(stored["sessions"][0])}
        assert client.get("/api/v1/frames", params=parameters).status_code == 200
        database = app.state.database
        assert database is not None
        assert client.get("/api/v1/frames", params=parameters).status_code == 200 and app.state.database is database
    assert app.state.database is None


def test_manual_seed_helper_creates_a_real_jpeg_and_only_deletes_its_demo_frame(stored):
    from scripts.demo_api_data import cleanup, seed
    unrelated = stored["save"]()
    created = seed(stored["sessions"][0])
    identifier = UUID(created["frame_id"])
    try:
        real_repository = FrameRepository.from_database(stored["database"])
        assert real_repository.load_frame_image(identifier).startswith(b"\xff\xd8")
        with pytest.raises(ValueError, match="Refusing"):
            cleanup(stored["sessions"][0], unrelated)
        assert stored["repository"].get_frame(unrelated) is not None
    finally:
        assert cleanup(stored["sessions"][0], identifier)["deleted"]
