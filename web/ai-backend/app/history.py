"""Member 2: store question, answer, language, timestamp and evidence IDs without touching multimedia tables.

GET /api/v1/questions returns the signed-in account's questions and answers, newest first, for the
dashboard's AI history page and the phone's History screen. `session_id` narrows it to one camera
session (as in the shared contract); without it, the whole account is listed.

Until the assistant answers real questions, an account with no history gets demo records instead,
marked `"demo": true` so no screen can mistake them for real answers.

Contract amendment (see docs/decision-log.md): each record also carries `session_id`, `uncertain`
and `evidence_frame_ids` from the AskResponse, so screens can show "not sure" and the evidence frames.
"""

import base64
import binascii
import json
import uuid
from contextlib import closing
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from app.auth import ApiError, _connect, _iso, _now, signed_in_user_id

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
    INDEX questions_user_time_idx (user_id, asked_at, question_id),
    INDEX questions_session_time_idx (session_id, asked_at),
    CONSTRAINT questions_user_fk FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
)"""
RETENTION = timedelta(hours=24)

# Same questions, IDs and evidence frame IDs as web/dashboard/src/data/mockData.js, so the dashboard
# can draw their evidence scenes. Times are placed a few minutes before "now" so they never look stale.
DEMO_SESSION = "550e8400-e29b-41d4-a716-446655440000"
DEMO = [
    ("2f3a2df0-3da3-446e-a59b-886f14d20dc5", 2, "What was written on that door?",
     "The sign appears to say ROOM 205.", "en", False, ["a1e5c9f3-7d2b-4c8e-9a6f-3b0d5e1c7a94"]),
    ("4b9c1e7a-2d5f-4a8c-9e3b-6f0a1d7c4e82", 3, "ماذا يوجد أمامي؟",
     "يبدو أن أمامك ممراً فارغاً مع أضواء في السقف.", "ar", False, ["0d6f1c52-8a43-4c1e-9f7e-2b1d0a7c5e11"]),
    ("7e2a5c9f-1b4d-4e6a-8c0f-3d9b2e5a7c14", 3.2, "What number is on the next door?",
     "I'm not sure. The sign was blurry; it might say ROOM 207.", "en", True, ["6a2e9b0f-3c71-4d58-8e2a-91f4c7d3b602"]),
    ("9d4f7b2e-6a1c-4d8f-b5e0-2c7a9f3d1b68", 3.5, "What does the notice board say?",
     "It shows lab hours from 9:00 to 17:00.", "en", False, ["9e41b7c2-0a5d-4e8f-b3c6-d2a7f9e1c054"]),
    ("1c8e3a6d-5f2b-4c9e-a7d1-8b4f0e2c6a35", 4.3, "Is there anything in my way?",
     "I can see a chair in the hallway ahead. I cannot tell you the path is clear.", "en", False,
     ["7b3f9d1e-6c2a-4e5b-8f0d-1a9c3e7b5d28", "2c7d5e8a-1f3b-4a6c-9d0e-8b5f2a7c1e46"]),
]


def init_history_table() -> None:
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(QUESTION_TABLE)


def _uuid(value: str, field: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ApiError(400, f"invalid_{field}", f"{field} must be a UUID.") from None


def record_question(user_id: str, session_id: str, question_id: str, question: str, answer: str,
                    language: str, uncertain: bool, evidence_frame_ids: list[str], asked_at: datetime | None = None) -> None:
    """Called by /api/v1/ask after answering. Saving the same question_id twice keeps the first answer."""
    if language not in ("en", "ar"):
        raise ValueError("language must be en or ar")
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT IGNORE INTO questions (question_id, user_id, session_id, asked_at, question, answer, language, "
            "uncertain, evidence_frame_ids) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (_uuid(question_id, "question_id"), user_id, _uuid(session_id, "session_id"), asked_at or _now(),
             question, answer, language, bool(uncertain), json.dumps([_uuid(i, "frame_id") for i in evidence_frame_ids])),
        )


def get_question(user_id: str, question_id: str) -> dict | None:
    """The saved record for this account's question_id, or None (used to make /ask safe to retry)."""
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM questions WHERE question_id = %s AND user_id = %s",
                    (_uuid(question_id, "question_id"), user_id))
        row = cur.fetchone()
    return _record(row) if row else None


def _record(row: dict, demo: bool = False) -> dict:
    evidence = row["evidence_frame_ids"]
    return {
        "question_id": row["question_id"], "session_id": row["session_id"], "asked_at": _iso(row["asked_at"]),
        "question": row["question"], "answer": row["answer"], "language": row["language"],
        "uncertain": bool(row["uncertain"]),
        "evidence_frame_ids": json.loads(evidence) if isinstance(evidence, str) else list(evidence),
        "demo": demo,
    }


def demo_records(now: datetime | None = None) -> list[dict]:
    now = now or _now()
    return [_record({"question_id": qid, "session_id": DEMO_SESSION, "asked_at": now - timedelta(minutes=minutes),
                     "question": question, "answer": answer, "language": language, "uncertain": uncertain,
                     "evidence_frame_ids": evidence}, demo=True)
            for qid, minutes, question, answer, language, uncertain, evidence in DEMO]


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
        if not rows and not cursor:
            cur.execute("SELECT 1 FROM questions WHERE user_id = %s AND asked_at > %s LIMIT 1", (user_id, now - RETENTION))
            if cur.fetchone() is None:
                demo = demo_records(now)
                return {"questions": demo[:limit], "next_cursor": None, "demo": True}
    records = [_record(row) for row in rows[:limit]]
    return {"questions": records, "next_cursor": _cursor(records[-1]) if len(rows) > limit else None, "demo": False}
