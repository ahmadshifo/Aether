"""Member 2: email + password accounts for the web dashboard: signup, login, logout and current user, stored in SQLite."""

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Cookie, Response, status
from pydantic import BaseModel

DB_PATH = Path(os.getenv("AUTH_DB_PATH", Path(__file__).resolve().parent.parent / "data" / "users.sqlite3"))
SESSION_COOKIE = "echosight_session"
SESSION_DAYS = 7
COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"  # true once served over HTTPS

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_MIN, PASSWORD_MAX = 8, 128
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1

# Simple brute-force guard: at most 5 failed logins per email in 15 minutes (per server process).
MAX_FAILURES, FAILURE_WINDOW = 5, 15 * 60
_failures: dict[str, list[float]] = {}

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class ApiError(Exception):
    """Raised by route handlers; main.py renders it as the agreed {"error": {"code", "message"}} body."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code, self.code, self.message = status_code, code, message


class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class ProfileUpdate(BaseModel):
    name: str


class User(BaseModel):
    user_id: str
    email: str
    name: str
    created_at: str


class UserResponse(BaseModel):
    user: User


# ---------- storage ----------

def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with closing(_connect()) as conn, conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            """
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def _user(row: sqlite3.Row) -> User:
    return User(user_id=row["user_id"], email=row["email"], name=row["name"], created_at=row["created_at"])


# ---------- passwords and sessions ----------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except ValueError:
        return False
    return hmac.compare_digest(candidate.hex(), digest)


# Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _start_session(conn: sqlite3.Connection, response: Response, user_id: str) -> None:
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(_now()),))
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (_token_hash(token), user_id, _iso(_now() + timedelta(days=SESSION_DAYS))),
    )
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/",
    )


def current_user(token: str | None) -> User | None:
    if not token:
        return None
    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.user_id = s.user_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?",
            (_token_hash(token), _iso(_now())),
        ).fetchone()
    return _user(row) if row else None


# ---------- validation ----------

def _clean_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise ApiError(400, "invalid_email", "Enter a valid email address.")
    return email


def _check_password(password: str) -> None:
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        raise ApiError(400, "weak_password", f"Password must be {PASSWORD_MIN} to {PASSWORD_MAX} characters.")


def _too_many_failures(email: str) -> bool:
    recent = [t for t in _failures.get(email, []) if time.monotonic() - t < FAILURE_WINDOW]
    _failures[email] = recent
    return len(recent) >= MAX_FAILURES


# ---------- routes ----------

def _clean_name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= 80:
        raise ApiError(400, "invalid_name", "Enter your name (up to 80 characters).")
    return name


@router.post("/signup", status_code=status.HTTP_201_CREATED, response_model=UserResponse)
def signup(body: SignupRequest, response: Response) -> UserResponse:
    name = _clean_name(body.name)
    email = _clean_email(body.email)
    _check_password(body.password)

    user = User(user_id=str(uuid.uuid4()), email=email, name=name, created_at=_iso(_now()))
    with closing(_connect()) as conn, conn:
        try:
            conn.execute(
                "INSERT INTO users (user_id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user.user_id, user.email, user.name, hash_password(body.password), user.created_at),
            )
        except sqlite3.IntegrityError:
            raise ApiError(409, "email_taken", "An account with this email already exists.") from None
        _start_session(conn, response, user.user_id)
    return UserResponse(user=user)


@router.post("/login", response_model=UserResponse)
def login(body: LoginRequest, response: Response) -> UserResponse:
    email = body.email.strip().lower()
    if _too_many_failures(email):
        raise ApiError(429, "too_many_attempts", "Too many failed attempts. Try again in 15 minutes.")

    with closing(_connect()) as conn, conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        password_ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH)
        if not row or not password_ok:
            _failures.setdefault(email, []).append(time.monotonic())
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        _failures.pop(email, None)
        _start_session(conn, response, row["user_id"])
    return UserResponse(user=_user(row))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, echosight_session: str | None = Cookie(default=None)) -> None:
    if echosight_session:
        with closing(_connect()) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(echosight_session),))
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserResponse)
def me(echosight_session: str | None = Cookie(default=None)) -> UserResponse:
    user = current_user(echosight_session)
    if not user:
        raise ApiError(401, "not_authenticated", "Log in to continue.")
    return UserResponse(user=user)


@router.patch("/me", response_model=UserResponse)
def update_me(body: ProfileUpdate, echosight_session: str | None = Cookie(default=None)) -> UserResponse:
    user = current_user(echosight_session)
    if not user:
        raise ApiError(401, "not_authenticated", "Log in to continue.")
    name = _clean_name(body.name)
    with closing(_connect()) as conn, conn:
        conn.execute("UPDATE users SET name = ? WHERE user_id = ?", (name, user.user_id))
    return UserResponse(user=user.model_copy(update={"name": name}))
