"""Member 2: define public answer, question-history, status and basic health endpoints.

POST /api/v1/ask (shared contract AskRequest -> AskResponse):
1. checks the camera session belongs to the signed-in account,
2. finds the evidence frames (assistant.py) and answers with Gemini from those pictures (vision_provider.py),
3. saves question + answer + evidence to the history,
4. asks the multimedia service to keep those frames (so their images survive the 2-minute memory).
Asking again with the same question_id returns the saved answer instead of answering twice.
"""

import logging
import uuid
from contextlib import closing
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app import assistant
from app.auth import ApiError, _connect, _now, signed_in_user_id
from app.history import get_question, record_question
from app.history_location import HistoryLocation
from app.memory_client import MemoryClient, MemoryUnavailable

router = APIRouter(prefix="/api/v1", tags=["ask"])
log = logging.getLogger("ai.ask")


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: uuid.UUID
    question_id: uuid.UUID
    question: str = Field(min_length=1, max_length=2000)
    language: Literal["en", "ar", "fr"]
    location: HistoryLocation | None = None


class AskResponse(BaseModel):
    question_id: uuid.UUID
    answer: str
    language: Literal["en", "ar", "fr"]
    uncertain: bool
    evidence_frame_ids: list[uuid.UUID]
    location: HistoryLocation | None = None


def memory_client(request: Request) -> MemoryClient:
    return MemoryClient(request.headers.get("cookie"))


def _check_session_owner(session_id: str, user_id: str) -> None:
    with closing(_connect()) as conn, conn.cursor() as cur:
        cur.execute("SELECT user_id FROM sessions WHERE session_id = %s", (session_id,))
        row = cur.fetchone()
    if row and row["user_id"] not in (None, user_id):
        raise ApiError(403, "session_not_yours", "This camera session belongs to another account.")


@router.post("/ask", response_model=AskResponse)
def ask(body: AskRequest, user_id: str = Depends(signed_in_user_id),
        memory: MemoryClient = Depends(memory_client)) -> AskResponse:
    session_id, question_id = str(body.session_id), str(body.question_id)
    question = body.question.strip()
    if not question:
        raise ApiError(400, "empty_question", "The question is empty.")
    saved = get_question(user_id, question_id)
    if saved:
        return AskResponse(question_id=question_id, answer=saved["answer"], language=saved["language"],
                           uncertain=saved["uncertain"], evidence_frame_ids=saved["evidence_frame_ids"], location=saved.get("location"))
    _check_session_owner(session_id, user_id)

    # The question's time is when it arrived; "what's in front of me" then waits a few seconds for newer frames.
    asked_at, arrived = _now(), datetime.now(UTC)
    result = assistant.answer(question, body.language, session_id, memory, asked_at=arrived)
    record_question(user_id, session_id, question_id, question, result.text, body.language,
                    result.uncertain, result.evidence_frame_ids, asked_at=asked_at, location=body.location)
    # A concurrent retry may have won INSERT IGNORE. Return what MySQL actually kept,
    # including that request's original area, rather than claiming a different tag was saved.
    persisted = get_question(user_id, question_id)
    if persisted is None:
        raise ApiError(503, "history_save_failed", "The answer could not be saved. Please try again.")
    if result.evidence_frame_ids:
        try:
            kept = memory.keep(session_id, result.evidence_frame_ids)
            if kept.get("missing"):
                log.warning("Question %s: %d evidence frame(s) were already gone", question_id, len(kept["missing"]))
        except MemoryUnavailable as error:
            log.warning("Question %s: evidence frames not kept (%s)", question_id, error)
    return AskResponse(question_id=question_id, answer=persisted["answer"], language=persisted["language"],
                       uncertain=persisted["uncertain"], evidence_frame_ids=persisted["evidence_frame_ids"], location=persisted.get("location"))
