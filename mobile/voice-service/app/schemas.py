from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Language = Literal["en", "ar", "fr"]


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1200)
    language: Language

    @field_validator("text")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("Text is required")
        return value


class Transcription(BaseModel):
    text: str
    language: Language
