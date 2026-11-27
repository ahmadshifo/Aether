from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Language = Literal["en", "ar", "fr"]

class TtsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    lang: Language = "en"
    speed: float = Field(default=1.0, ge=0.7, le=2.0)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("empty_text")
        return value

class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    language: Language = "en"

    @field_validator("text")
    @classmethod
    def clean_text(cls, value):
        return TtsRequest.clean_text(value)
