"""Pydantic v2 public wire models; no database rows or private storage fields."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import (AwareDatetime, BaseModel, ConfigDict, Field, StrictInt, StrictStr,
                      field_serializer, field_validator, model_validator)

from processing.embedding_service import validate_text
from database.validation import as_utc


class PublicModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SearchRequest(PublicModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{
        "session_id": "550e8400-e29b-41d4-a716-446655440000", "query": "What was written on the classroom door?",
        "mode": "recent", "limit": 5}]})
    session_id: UUID
    query: StrictStr = Field(description="Nonempty query; never silently truncated.")
    mode: Literal["latest", "recent", "history"]
    limit: Annotated[StrictInt, Field(ge=1, le=20)]

    @field_validator("query")
    @classmethod
    def meaningful_query(cls, value):
        value = validate_text(value)
        if not any(character.isalnum() for character in value):
            raise ValueError("Query must contain meaningful text.")
        return value


class FrameMetadata(PublicModel):
    frame_id: UUID
    session_id: UUID
    timestamp: AwareDatetime
    captured_at: AwareDatetime
    image_url: StrictStr
    caption: StrictStr
    ocr_text: StrictStr
    objects: list[StrictStr]

    @field_validator("timestamp", "captured_at", mode="before")
    @classmethod
    def utc(cls, value):
        # Reject numeric/video-relative offsets rather than interpreting them
        # as Unix times and silently manufacturing an absolute capture time.
        return as_utc(value)

    @field_serializer("timestamp", "captured_at")
    def utc_wire(self, value):
        return value.isoformat().replace("+00:00", "Z")

    @model_validator(mode="after")
    def coherent_metadata(self):
        if self.timestamp != self.captured_at:
            raise ValueError("Timestamp aliases must describe the same instant.")
        if self.image_url != f"/api/v1/frames/{self.frame_id}/image":
            raise ValueError("Invalid public image URL.")
        return self


class SearchFrame(FrameMetadata):
    relevance_score: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]

    @field_validator("relevance_score", mode="before")
    @classmethod
    def numerical_score(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Relevance score must be numerical.")
        return value


class SearchResponse(PublicModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"frames": []}]})
    frames: list[SearchFrame]


class TimelineResponse(PublicModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"frames": [], "next_cursor": None}]})
    frames: list[FrameMetadata]
    next_cursor: str | None


class HealthResponse(PublicModel):
    status: Literal["ok"] = "ok"
    service: Literal["aether-multimedia"] = "aether-multimedia"
    version: Literal["1.0.0"] = "1.0.0"


class ErrorDetail(PublicModel):
    code: str
    message: str
    fields: list[str] = Field(default_factory=list)


class ErrorResponse(PublicModel):
    error: ErrorDetail
