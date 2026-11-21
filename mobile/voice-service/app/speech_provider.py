"""Member 1: wrap the Azure Speech API for English, Lebanese Arabic and French speech synthesis.

Used by POST /api/v1/voice/synthesize (app/routes.py), which the dashboard's AI History player calls to read an
answer aloud. It calls Azure's text-to-speech REST endpoint directly (no SDK needed) and returns MP3 bytes.

Settings (mobile/voice-service/.env, never committed):
- AZURE_SPEECH_KEY     the Speech resource key
- AZURE_SPEECH_REGION  its region, e.g. westeurope

Speech recognition is done on the phone itself (expo-speech-recognition), so there is no transcribe call here.
"""

import os
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
# Neural voices per app language; ar-LB is Lebanese Arabic.
VOICES = {"en": ("en-US", "en-US-JennyNeural"), "ar": ("ar-LB", "ar-LB-LaylaNeural"), "fr": ("fr-FR", "fr-FR-DeniseNeural")}
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
TIMEOUT_SECONDS = 15


class SpeechUnavailable(RuntimeError):
    """reason: "not_configured" (no key/region) or "failed" (Azure refused or could not be reached)."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason


def _settings() -> tuple[str, str]:
    """(key, region) from the environment, or else from the service's own .env file."""
    values = {name: os.getenv(name, "").strip() for name in ("AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION")}
    if not all(values.values()) and ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() in values and not values[name.strip()]:
                values[name.strip()] = value.strip().strip('"').strip("'")
    return values["AZURE_SPEECH_KEY"], values["AZURE_SPEECH_REGION"]


def configured() -> bool:
    return all(_settings())


def ssml(text: str, language: str) -> str:
    locale, voice = VOICES[language]
    return (f"<speak version='1.0' xml:lang='{locale}'><voice xml:lang='{locale}' name='{voice}'>"
            f"{escape(text)}</voice></speak>")


def _post(url: str, key: str, body: bytes) -> bytes:
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT, "User-Agent": "aether-voice-service",
    })
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def synthesize(text: str, language: str) -> bytes:
    """MP3 audio of the text read in the language's voice. Raises SpeechUnavailable."""
    key, region = _settings()
    if not key or not region:
        raise SpeechUnavailable("not_configured")
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    try:
        audio = _post(url, key, ssml(text, language).encode("utf-8"))
    except urllib.error.HTTPError as error:
        raise SpeechUnavailable("failed", f"HTTP {error.code}") from None  # never echo the key or the body
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise SpeechUnavailable("failed", type(error).__name__) from None
    if not audio:
        raise SpeechUnavailable("failed", "empty audio")
    return audio
