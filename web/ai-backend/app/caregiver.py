"""Member 2: what the caregiver sees of the phone, and what they can send to it.

- Battery: during a session the phone reports its battery level and whether it is charging
  (POST /api/v1/device); the dashboard shows it next to the live camera (GET /api/v1/device), and a low
  battery becomes a camera alert (app/alerts.py).
- Caregiver notes: the caregiver types a short message on the dashboard (POST /api/v1/notes); the phone
  checks for new ones during a session (GET /api/v1/notes/pending), reads each aloud when it is not busy
  answering, and marks it read (POST /api/v1/notes/{note_id}/read), so the dashboard can show "Read aloud at ...".

Each account only ever sees its own phone and notes. Notes are kept for 24 hours, like everything else.
"""

import uuid
from contextlib import closing
from datetime import timedelta

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id

router = APIRouter(prefix="/api/v1", tags=["caregiver"])

DEVICE_TABLE = """CREATE TABLE IF NOT EXISTS device_status (
    user_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin    NOT NULL PRIMARY KEY,
    session_id  CHAR(36)    NULL,
    battery     TINYINT     NOT NULL,
    charging    BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at  DATETIME(3) NOT NULL,
    CONSTRAINT device_status_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
NOTES_TABLE = """CREATE TABLE IF NOT EXISTS caregiver_notes (
    note_id     CHAR(36)     NOT NULL PRIMARY KEY,
    user_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin     NOT NULL,
    text        VARCHAR(300) NOT NULL,
    created_at  DATETIME(3)  NOT NULL,
    read_at     DATETIME(3)  NULL,
    INDEX caregiver_notes_user_time_idx (user_id, created_at),
    CONSTRAINT caregiver_notes_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""

NOTES_WINDOW = timedelta(hours=24)
# A battery report older than this is from a phone that stopped reporting (session ended, app closed).
DEVICE_FRESH = timedelta(minutes=10)
# Low-battery alert on the dashboard, like the phone's own spoken warning.
LOW_BATTERY = 20


def init_caregiver_tables() -> None:
    """Creates the two tables on startup if they don't exist yet (never drops or changes data)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        for statement in (DEVICE_TABLE, NOTES_TABLE):
            cur.execute(statement)


# ---------- battery ----------

class DeviceBody(BaseModel):
    session_id: str | None = None
    battery: int = Field(ge=0, le=100)
    charging: bool = False


def _uuid_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError(400, "invalid_session_id", "session_id must be a UUID.") from None


@router.post("/device")
def report_device(body: DeviceBody, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The phone's battery, sent when a session starts and whenever the level or charging changes."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO device_status (user_id, session_id, battery, charging, updated_at) VALUES (%s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), battery = VALUES(battery), "
            "charging = VALUES(charging), updated_at = VALUES(updated_at)",
            (user_id, _uuid_or_none(body.session_id), body.battery, body.charging, _now()),
        )
    return {"ok": True}


def device_status(user_id: str) -> dict | None:
    """The phone's latest battery report, or None when there is none or it is too old to trust."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT session_id, battery, charging, updated_at FROM device_status WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    if not row or _now() - row["updated_at"] > DEVICE_FRESH:
        return None
    return {"session_id": row["session_id"], "battery": int(row["battery"]), "charging": bool(row["charging"]),
            "updated_at": _iso(row["updated_at"])}


@router.get("/device")
def read_device(user_id: str = Depends(signed_in_user_id)) -> dict:
    return {"device": device_status(user_id)}


# ---------- caregiver notes ----------

class NoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=300)


def _note(row: dict) -> dict:
    return {"note_id": row["note_id"], "text": row["text"], "created_at": _iso(row["created_at"]),
            "read_at": _iso(row["read_at"]) if row["read_at"] else None}


def clean_note(text: str) -> str:
    """One line of plain text, so the phone reads it as it was typed."""
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ApiError(400, "empty_note", "The message is empty.")
    return cleaned


@router.post("/notes", status_code=status.HTTP_201_CREATED)
def send_note(body: NoteBody, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The caregiver's message; the phone reads it aloud during the next or current session."""
    row = {"note_id": str(uuid.uuid4()), "text": clean_note(body.text), "created_at": _now(), "read_at": None}
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO caregiver_notes (note_id, user_id, text, created_at) VALUES (%s, %s, %s, %s)",
                    (row["note_id"], user_id, row["text"], row["created_at"]))
    return {"note": _note(row)}


@router.get("/notes")
def list_notes(user_id: str = Depends(signed_in_user_id)) -> dict:
    """This account's messages from the last 24 hours, newest first (for the dashboard)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT note_id, text, created_at, read_at FROM caregiver_notes WHERE user_id = %s AND created_at >= %s "
                    "ORDER BY created_at DESC LIMIT 50", (user_id, _now() - NOTES_WINDOW))
        rows = cur.fetchall()
    return {"notes": [_note(row) for row in rows]}


@router.get("/notes/pending")
def pending_notes(user_id: str = Depends(signed_in_user_id)) -> dict:
    """Messages the phone hasn't read aloud yet, oldest first (for the phone)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT note_id, text, created_at, read_at FROM caregiver_notes WHERE user_id = %s AND read_at IS NULL "
                    "AND created_at >= %s ORDER BY created_at LIMIT 10", (user_id, _now() - NOTES_WINDOW))
        rows = cur.fetchall()
    return {"notes": [_note(row) for row in rows]}


@router.post("/notes/{note_id}/read")
def mark_read(note_id: str, user_id: str = Depends(signed_in_user_id)) -> dict:
    """The phone read this message aloud."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE caregiver_notes SET read_at = %s WHERE note_id = %s AND user_id = %s AND read_at IS NULL",
                    (_now(), note_id, user_id))
    return {"ok": True}
