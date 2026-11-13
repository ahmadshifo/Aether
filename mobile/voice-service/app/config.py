from dataclasses import dataclass, field
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit
from dotenv import dotenv_values


@dataclass(frozen=True)
class Settings:
    groq_key: str = field(default="", repr=False)
    gemini_key: str = field(default="", repr=False)
    stt_model: str = "whisper-large-v3"
    tts_model: str = "gemini-3.8-flash-tts"
    tts_voice: str = "Kore"
    auth_origin: str = "http://127.0.0.1:8002"
    origins: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")
    ffmpeg: str = "ffmpeg"

    @property
    def audio_ready(self):
        return shutil.which(self.ffmpeg) is not None

    @classmethod
    def load(cls):
        values = {**dotenv_values(Path(__file__).resolve().parents[1] / ".env"), **os.environ}
        origin = values.get("VOICE_AUTH_ORIGIN", "http://127.0.0.1:8002").rstrip("/")
        url = urlsplit(origin)
        if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
            raise ValueError("VOICE_AUTH_ORIGIN must be a trusted backend origin")
        return cls(groq_key=values.get("GROQ_API_KEY", "").strip(),
                   gemini_key=values.get("GEMINI_API_KEY", "").strip(),
                   stt_model=values.get("GROQ_STT_MODEL", "whisper-large-v3"),
                   tts_model=values.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
                   tts_voice=values.get("GEMINI_TTS_VOICE", "Kore"), auth_origin=origin,
                   ffmpeg=values.get("VOICE_FFMPEG", "ffmpeg"),
                   origins=tuple(x.strip() for x in values.get("VOICE_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(",") if x.strip()))
