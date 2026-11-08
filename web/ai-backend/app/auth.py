"""Member 2: email + password accounts for the web dashboard and the phone: signup, login, logout and current user.

Sessions are a short-lived JWT plus a refresh session stored in the multimedia MySQL database:
- echosight_access: a signed JWT (HS256, 15 minutes). Each request is checked by its signature alone.
- echosight_session: a random refresh token; only its hash is stored in login_sessions. When the JWT has expired,
  it quietly issues a new one. It ends after 8 hours without use, or 7 days after login, whichever comes first.
Logout deletes the refresh session, so a stolen JWT stops working within 15 minutes at most.
"""

import hashlib
import hmac
import os
import re
import secrets
import time
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pymysql
from dotenv import dotenv_values
from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel


def _load_env_file() -> None:
    # Process settings override the backend file; shared database settings fall
    # back to the same private file used by multimedia. Parse quoted passwords.
    root = Path(__file__).resolve().parents[3]
    shared = dotenv_values(root / "multimedia" / "api" / ".env", interpolate=False)
    defaults = {key: value for key, value in shared.items() if key.startswith("MYSQL_")}
    own = dotenv_values(Path(__file__).resolve().parent.parent / ".env", interpolate=False)
    for key, value in {**defaults, **own}.items():
        if value is not None:
            os.environ.setdefault(key, value)


_load_env_file()

ACCESS_COOKIE = "echosight_access"
SESSION_COOKIE = "echosight_session"  # the refresh token; same name as before, so existing logins keep working
ACCESS_TTL = timedelta(minutes=float(os.getenv("AUTH_ACCESS_MINUTES", "15")))
IDLE_TTL = timedelta(hours=float(os.getenv("AUTH_IDLE_HOURS", "8")))
MAX_TTL = timedelta(days=float(os.getenv("AUTH_MAX_DAYS", "7")))
COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"  # true once served over HTTPS

# Without a JWT_SECRET, a random one is used: tokens then stop at restart, and the refresh session reissues them.
JWT_SECRET = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)
JWT_ALGORITHM = "HS256"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_MIN, PASSWORD_MAX = 8, 128
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1
DUPLICATE_KEY = 1062  # MySQL error code for a UNIQUE violation

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

def _connect() -> pymysql.connections.Connection:
    try:
        return pymysql.connect(
            host=os.getenv("MYSQL_HOST", "127.0.0.1"), port=int(os.getenv("MYSQL_PORT", "3306")),
            user=os.getenv("MYSQL_USER", ""), password=os.getenv("MYSQL_PASSWORD", ""),
            database=os.getenv("MYSQL_DATABASE", "multimedia_project"),
            charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, autocommit=True,
            connect_timeout=5, read_timeout=15, write_timeout=15,
            init_command="SET SESSION time_zone = '+00:00'",
        )
    except pymysql.err.OperationalError:
        raise ApiError(503, "database_unavailable", "Can't reach the database. Is MySQL running?") from None



def init_db() -> None:
    try:
        with closing(_connect()) as conn, conn.cursor() as cur:
            cur.execute("SELECT u.user_id, u.email, u.name, u.password_hash, u.created_at, "
                        "s.token_hash, s.created_at, s.expires_at "
                        "FROM users u JOIN login_sessions s USING (user_id) LIMIT 0")
            cur.execute("SELECT session_id, user_id, status, started_at, ended_at FROM sessions LIMIT 0")
    except (ApiError, pymysql.err.MySQLError):
        raise RuntimeError(
            "Auth needs the shared MySQL database: set MYSQL_* in web/ai-backend/.env "
            "and run `python -m database.connection --init` in the multimedia folder."
        ) from None


def _now() -> datetime:
    # Raw PyMySQL values are naive UTC; the schema preserves DATETIME(6).
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds") + "Z"


def _user(row: dict) -> User:
    return User(user_id=row["user_id"], email=row["email"], name=row["name"], created_at=_iso(row["created_at"]))


# ---------- passwords ----------

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


# ---------- tokens and sessions ----------

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _set_cookie(response: Response, name: str, value: str, max_age: timedelta) -> None:
    response.set_cookie(
        name, value, max_age=int(max_age.total_seconds()),
        httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/",
    )


def _issue_access_token(response: Response, user_id: str) -> None:
    issued = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": user_id, "typ": "access", "iat": issued, "exp": issued + ACCESS_TTL},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    _set_cookie(response, ACCESS_COOKIE, token, ACCESS_TTL)


def _start_session(cur: pymysql.cursors.Cursor, response: Response, user_id: str) -> None:
    token = secrets.token_urlsafe(32)
    now = _now()
    cur.execute("DELETE FROM login_sessions WHERE user_id = %s AND (expires_at < %s OR created_at < %s)",
                (user_id, now, now - MAX_TTL))
    cur.execute(
        "INSERT INTO login_sessions (token_hash, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
        (_token_hash(token), user_id, now, now + IDLE_TTL),
    )
    _set_cookie(response, SESSION_COOKIE, token, MAX_TTL)
    _issue_access_token(response, user_id)


def _user_id_from_access_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "sub"]})
    except jwt.InvalidTokenError:  # expired, tampered with, or signed with another secret
        return None
    return claims["sub"] if claims.get("typ") == "access" else None


def _refresh(token: str | None, response: Response) -> str | None:
    """A valid refresh session gets a new 15-minute JWT and another 8 idle hours (never past 7 days from login)."""
    if not token:
        return None
    now = _now()
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT user_id, created_at FROM login_sessions WHERE token_hash = %s AND expires_at > %s AND created_at > %s",
            (_token_hash(token), now, now - MAX_TTL),
        )
        row = cur.fetchone()
        if not row:
            return None
        cur.execute(
            "UPDATE login_sessions SET expires_at = %s WHERE token_hash = %s",
            (min(now + IDLE_TTL, row["created_at"] + MAX_TTL), _token_hash(token)),
        )
    _issue_access_token(response, row["user_id"])
    return row["user_id"]


def signed_in_user_id(request: Request, response: Response) -> str:
    """FastAPI dependency: the signed-in user's ID from the JWT, refreshed from the session when it has expired."""
    user_id = _user_id_from_access_token(request.cookies.get(ACCESS_COOKIE)) or _refresh(request.cookies.get(SESSION_COOKIE), response)
    if not user_id:
        raise ApiError(401, "not_authenticated", "Log in to continue.")
    return user_id


def current_user(user_id: str = Depends(signed_in_user_id)) -> User:
    """FastAPI dependency: the signed-in user's account."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row:  # the account was deleted while its token was still valid
        raise ApiError(401, "not_authenticated", "Log in to continue.")
    return _user(row)


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


def _clean_name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= 80:
        raise ApiError(400, "invalid_name", "Enter your name (up to 80 characters).")
    return name


# ---------- routes ----------

@router.post("/signup", status_code=status.HTTP_201_CREATED, response_model=UserResponse)
def signup(body: SignupRequest, response: Response) -> UserResponse:
    name = _clean_name(body.name)
    email = _clean_email(body.email)
    _check_password(body.password)

    created_at = _now()
    user = User(user_id=str(uuid.uuid4()), email=email, name=name, created_at=_iso(created_at))
    with closing(_connect()) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                "INSERT INTO users (user_id, email, name, password_hash, created_at) VALUES (%s, %s, %s, %s, %s)",
                (user.user_id, user.email, user.name, hash_password(body.password), created_at),
            )
        except pymysql.err.IntegrityError as error:
            if error.args[0] != DUPLICATE_KEY:
                raise
            raise ApiError(409, "email_taken", "An account with this email already exists.") from None
        _start_session(cur, response, user.user_id)
    return UserResponse(user=user)


@router.post("/login", response_model=UserResponse)
def login(body: LoginRequest, response: Response) -> UserResponse:
    email = body.email.strip().lower()
    if _too_many_failures(email):
        raise ApiError(429, "too_many_attempts", "Too many failed attempts. Try again in 15 minutes.")

    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        password_ok = verify_password(body.password, row["password_hash"] if row else _DUMMY_HASH)
        if not row or not password_ok:
            _failures.setdefault(email, []).append(time.monotonic())
            raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
        _failures.pop(email, None)
        _start_session(cur, response, row["user_id"])
    return UserResponse(user=_user(row))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    refresh = request.cookies.get(SESSION_COOKIE)
    if refresh:
        with closing(_connect()) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM login_sessions WHERE token_hash = %s", (_token_hash(refresh),))
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(current_user)) -> UserResponse:
    return UserResponse(user=user)


@router.patch("/me", response_model=UserResponse)
def update_me(body: ProfileUpdate, user: User = Depends(current_user)) -> UserResponse:
    name = _clean_name(body.name)
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET name = %s WHERE user_id = %s", (name, user.user_id))
    return UserResponse(user=user.model_copy(update={"name": name}))
