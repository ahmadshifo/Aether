"""Optional area labels attached to a question, not continuous tracking or raw coordinates."""
import re

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class HistoryLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=160, strict=True)
    captured_at: AwareDatetime

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str) -> str:
        value = value.strip()
        if not value or re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError("location label must be a non-empty single line")
        return value
