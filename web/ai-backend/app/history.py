"""Member 2: store question, answer, language, timestamp and evidence IDs without touching multimedia tables.

GET /api/v1/questions returns the signed-in account's questions and answers, newest first, for the
dashboard's AI history page and the phone's History screen. `session_id` narrows it to one camera
session (as in the shared contract); without it, the whole account is listed.

An account with no questions gets an empty list. `"demo"` is always false: it stays in the response only
so older phone builds that read it keep working (there are no sample records any more).

Contract amendment (see docs/decision-log.md): each record also carries `session_id`, `uncertain`
and `evidence_frame_ids` from the AskResponse, so screens can show "not sure" and the evidence frames.
"""

import base64
import binascii
import json
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id
from app.history_location import HistoryLocation
from pymysql.err import OperationalError

router = APIRouter(prefix="/api/v1", tags=["history"])

QUESTION_TABLE = """CREATE TABLE IF NOT EXISTS questions (
    question_id        CHAR(36)     NOT NULL PRIMARY KEY,
    user_id            CHAR(36)     NOT NULL,
    session_id         CHAR(36)     NOT NULL,
    asked_at           DATETIME(3)  NOT NULL,
    question           TEXT         NOT NULL,
    answer             TEXT         NOT NULL,
    language           VARCHAR(2)   NOT NULL,
    uncertain          BOOLEAN      NOT NULL DEFAULT FALSE,
    evidence_frame_ids JSON         NOT NULL,
    location_label     VARCHAR(160) NULL,
    location_captured_at DATETIME(3) NULL,
    INDEX questions_user_time_idx (user_id, asked_at, question_id),
    INDEX questions_session_time_idx (session_id, asked_at),
    CONSTRAINT questions_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
RETENTION = timedelta(hours=24)

def init_history_table() -> None:
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(QUESTION_TABLE)
        # Additive and repeatable: older entries keep NULL, and no existing record is rewritten.
        cur.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    "AND TABLE_NAME = 'questions' AND COLUMN_NAME IN ('location_label', 'location_captured_at')")
        present = {row["COLUMN_NAME"] for row in cur.fetchall()}
        for name, definition in (("location_label", "VARCHAR(160) NULL"), ("location_captured_at", "DATETIME(3) NULL")):
            if name not in present:
                try:
                    cur.execute(f"ALTER TABLE questions ADD COLUMN {name} {definition}")
                except OperationalError as error:
                    if error.args[0] != 1060:  # Another startup process already added this column.
                        raise


def _uuid(value: str, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ApiError(400, f"invalid_{field}", f"{field} must be a UUID.") from None


def record_question(user_id: str, session_id: str, question_id: str, question: str, answer: str,
                    language: str, uncertain: bool, evidence_frame_ids: list[str], asked_at: datetime | None = None,
                    location: HistoryLocation | None = None) -> None:
    """Called by /api/v1/ask after answering. Saving the same question_id twice keeps the first answer."""
    if language not in ("en", "ar", "fr"):
        raise ValueError("language must be en, ar or fr")
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT IGNORE INTO questions (question_id, user_id, session_id, asked_at, question, answer, language, "
            "uncertain, evidence_frame_ids, location_label, location_captured_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (_uuid(question_id, "question_id"), user_id, _uuid(session_id, "session_id"), asked_at or _now(),
             question, answer, language, bool(uncertain), json.dumps([_uuid(i, "frame_id") for i in evidence_frame_ids]),
             location.label if location else None,
             location.captured_at.astimezone(UTC).replace(tzinfo=None) if location else None),
        )


def get_question(user_id: str, question_id: str) -> dict | None:
    """The saved record for this account's question_id, or None (used to make /ask safe to retry)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM questions WHERE question_id = %s AND user_id = %s",
                    (_uuid(question_id, "question_id"), user_id))
        row = cur.fetchone()
    return _record(row) if row else None


def _record(row: dict) -> dict:
    evidence = row["evidence_frame_ids"]
    return {
        "question_id": row["question_id"], "session_id": row["session_id"], "asked_at": _iso(row["asked_at"]),
        "question": row["question"], "answer": row["answer"], "language": row["language"],
        "uncertain": bool(row["uncertain"]),
        "evidence_frame_ids": json.loads(evidence) if isinstance(evidence, str) else list(evidence),
        "demo": False,
        "location": {"label": row["location_label"], "captured_at": _iso(row["location_captured_at"])}
        if row.get("location_label") and row.get("location_captured_at") else None,
    }


def _cursor(record: dict) -> str:
    return base64.urlsafe_b64encode(f"{record['asked_at']}|{record['question_id']}".encode()).decode().rstrip("=")


def _decode(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        moment, question_id = raw.split("|")
        return datetime.fromisoformat(moment.removesuffix("Z")), str(uuid.UUID(question_id))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise ApiError(400, "invalid_cursor", "cursor is not a value returned by this API.") from None


@router.delete("/questions")
def delete_questions(session_id: str | None = None, user_id: str = Depends(signed_in_user_id)) -> dict:
    """Deletes the signed-in account's questions and answers (one session, or all). Cannot be undone."""
    where, params = ["user_id = %s"], [user_id]
    if session_id:
        where.append("session_id = %s")
        params.append(_uuid(session_id, "session_id"))
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(f"DELETE FROM questions WHERE {' AND '.join(where)}", params)
        return {"deleted": cur.rowcount}


@router.get("/questions")
def questions(session_id: str | None = None, limit: int = Query(20, ge=1, le=100), cursor: str | None = None,
              user_id: str = Depends(signed_in_user_id)) -> dict:
    now = _now()
    where, params = ["user_id = %s", "asked_at > %s"], [user_id, now - RETENTION]
    if session_id:
        where.append("session_id = %s")
        params.append(_uuid(session_id, "session_id"))
    if cursor:
        moment, question_id = _decode(cursor)
        where.append("(asked_at < %s OR (asked_at = %s AND question_id < %s))")
        params += [moment, moment, question_id]
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM questions WHERE {' AND '.join(where)} "
                    "ORDER BY asked_at DESC, question_id DESC LIMIT %s", (*params, limit + 1))
        rows = cur.fetchall()
    records = [_record(row) for row in rows[:limit]]
    return {"questions": records, "next_cursor": _cursor(records[-1]) if len(rows) > limit else None, "demo": False}
