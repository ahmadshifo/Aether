"""Member 1: request validation for the voice service: the text to read and its language."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)
    language: Literal["en", "ar", "fr"] = "en"
