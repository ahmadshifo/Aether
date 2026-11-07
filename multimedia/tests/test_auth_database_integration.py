"""Real signup/login and stream-account integration, using only synthetic users."""

import importlib
import os
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from database.connection import Database

pytestmark = pytest.mark.skipif(os.environ.get("RUN_MYSQL_TESTS") != "1",
                                reason="Set RUN_MYSQL_TESTS=1 for real MySQL authentication tests")


@pytest.fixture(scope="module")
def auth_backend():
    patcher = pytest.MonkeyPatch()
    patcher.syspath_prepend(str(Path(__file__).resolve().parents[2] / "web" / "ai-backend"))
    with Database() as database:
        database.initialize_schema()
        url = database.settings.url
        for key, value in {"MYSQL_HOST": url.host, "MYSQL_PORT": str(url.port or 3306),
                           "MYSQL_DATABASE": url.database, "MYSQL_USER": url.username,
                           "MYSQL_PASSWORD": url.password}.items():
            patcher.setenv(key, value)
        main = importlib.import_module("app.main")
        auth = importlib.import_module("app.auth")
        try:
            yield main.app, auth, database
        finally:
            patcher.undo()


@pytest.fixture
def account_client(auth_backend):
    app, auth, database = auth_backend
    emails, stream_ids = [], []
    password = "Synthetic-Test-Password-93!"
    with TestClient(app) as client:
        def signup():
            email = f"aether-test-{uuid4().hex}@example.invalid"
            emails.append(email)
            response = client.post("/api/v1/auth/signup",
                                   json={"name": "Synthetic Test User", "email": email, "password": password})
            assert response.status_code == 201, response.text
            return response.json()["user"], password

        try:
            yield client, signup, database, auth, stream_ids
        finally:
            with database.engine.begin() as connection:
                for identifier in stream_ids:
                    connection.execute(text("DELETE FROM sessions WHERE session_id = :id"), {"id": identifier})
                for email in emails:
                    connection.execute(text("DELETE FROM users WHERE email = :email"), {"email": email})
            for email in emails:
                auth._failures.pop(email, None)


def test_signup_stores_hash_and_sets_authenticated_cookies(account_client):
    client, signup, database, auth, _ = account_client
    user, password = signup()
    assert client.get("/api/v1/auth/me").json()["user"]["user_id"] == user["user_id"]
    assert auth.ACCESS_COOKIE in client.cookies and auth.SESSION_COOKIE in client.cookies
    with database.engine.connect() as connection:
        row = connection.execute(text("SELECT password_hash FROM users WHERE user_id = :id"),
                                 {"id": user["user_id"]}).scalar_one()
        assert row != password and row.startswith("scrypt$") and auth.verify_password(password, row)
        hashes = connection.execute(text("SELECT token_hash FROM login_sessions WHERE user_id = :id"),
                                    {"id": user["user_id"]}).scalars().all()
        assert len(hashes) == 1 and hashes[0] == auth._token_hash(client.cookies.get(auth.SESSION_COOKIE))
    duplicate = client.post("/api/v1/auth/signup", json={"name": "Duplicate", "email": user["email"], "password": password})
    assert duplicate.status_code == 409


def test_login_logout_and_wrong_password(account_client):
    client, signup, database, _, _ = account_client
    user, password = signup()
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    wrong = client.post("/api/v1/auth/login", json={"email": user["email"], "password": "Wrong-Password-93!"})
    assert wrong.status_code == 401
    correct = client.post("/api/v1/auth/login", json={"email": user["email"], "password": password})
    assert correct.status_code == 200 and correct.json()["user"]["user_id"] == user["user_id"]
    assert client.post("/api/v1/auth/logout").status_code == 204
    with database.engine.connect() as connection:
        assert connection.scalar(text("SELECT COUNT(*) FROM login_sessions WHERE user_id = :id"),
                                 {"id": user["user_id"]}) == 0


def test_refresh_renews_missing_access_cookie(account_client):
    client, signup, _, auth, _ = account_client
    user, _ = signup()
    client.cookies.delete(auth.ACCESS_COOKIE)
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200 and response.json()["user"]["user_id"] == user["user_id"]
    assert auth.ACCESS_COOKIE in client.cookies


def test_expired_refresh_session_is_rejected(account_client):
    client, signup, database, auth, _ = account_client
    user, _ = signup()
    with database.engine.begin() as connection:
        connection.execute(text("UPDATE login_sessions SET created_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR, "
                                "expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 HOUR WHERE user_id = :id"),
                           {"id": user["user_id"]})
    client.cookies.delete(auth.ACCESS_COOKIE)
    assert client.get("/api/v1/auth/me").status_code == 401


def test_account_persists_for_a_new_client(account_client, auth_backend):
    client, signup, _, _, _ = account_client
    user, password = signup()
    with TestClient(auth_backend[0]) as another:
        assert another.get("/api/v1/auth/me").status_code == 401
        response = another.post("/api/v1/auth/login", json={"email": user["email"], "password": password})
        assert response.status_code == 200 and response.json()["user"]["user_id"] == user["user_id"]


def test_schema_reinitialization_preserves_registered_account(account_client):
    client, signup, database, _, _ = account_client
    user, _ = signup()
    database.initialize_schema()
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200 and response.json()["user"]["user_id"] == user["user_id"]


def test_stream_sessions_use_the_signed_in_account(account_client):
    client, signup, database, _, stream_ids = account_client
    first, _ = signup()
    identifier = str(uuid4())
    stream_ids.append(identifier)
    assert client.post("/api/v1/streams/start", json={"session_id": identifier}).status_code == 200
    assert client.get("/api/v1/streams/active").json()["session"]["session_id"] == identifier
    client.post("/api/v1/auth/logout")
    second, _ = signup()
    assert client.get("/api/v1/streams/active").json()["session"] is None
    assert client.post("/api/v1/streams/start", json={"session_id": identifier}).status_code == 409
    with database.engine.connect() as connection:
        assert connection.scalar(text("SELECT user_id FROM sessions WHERE session_id = :id"),
                                 {"id": identifier}) == first["user_id"]


def test_signup_validation_rejects_invalid_input(account_client):
    client, _, _, _, _ = account_client
    assert client.post("/api/v1/auth/signup", json={"name": "Test", "email": "invalid", "password": "LongEnough-93!"}).status_code == 400
    assert client.post("/api/v1/auth/signup", json={"name": "Test", "email": "test@example.invalid", "password": "short"}).status_code == 400
