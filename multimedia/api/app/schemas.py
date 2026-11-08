"""Member 3: validate shared Frame, SearchRequest, SearchResponse and timeline pagination schemas.

Field names and limits follow shared/contracts/api-v1.yaml exactly.
"""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    query: str = Field(max_length=1000)
    mode: Literal["latest", "recent", "history"]
    limit: int = Field(ge=1, le=20)


class Frame(BaseModel):
    frame_id: UUID
    session_id: UUID
    captured_at: datetime
    image_url: str
    caption: str
    ocr_text: str
    objects: list[str]

    @field_serializer("captured_at")
    def _utc(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SearchFrame(Frame):
    relevance_score: float = Field(ge=0, le=1)


class SearchResponse(BaseModel):
    frames: list[SearchFrame]


class KeepRequest(BaseModel):
    """Member 2 -> Member 3 after an answer: save the frames the answer used (evidence_frame_ids)."""
    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    frame_ids: list[UUID] = Field(min_length=1, max_length=20)


class KeepResponse(BaseModel):
    accepted: list[UUID]   # being saved now, or already saved
    missing: list[UUID]    # unknown, from another session, or already forgotten (older than 2 minutes)


class FramePage(BaseModel):
    frames: list[Frame]
    next_cursor: str | None


def image_url(frame_id: UUID) -> str:
    return f"/api/v1/frames/{frame_id}/image"


def frame_from_record(record, model=Frame, **extra):
    return model(frame_id=record.frame_id, session_id=record.session_id, captured_at=record.captured_at,
                 image_url=image_url(record.frame_id), caption=record.caption, ocr_text=record.ocr_text,
                 objects=list(record.objects), **extra)
