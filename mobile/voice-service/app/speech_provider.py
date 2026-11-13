"""Server-only adapters. No global credentials, paid fallback, or automatic retry."""
import base64
import asyncio
import binascii
import json
import httpx
from .config import Settings
from .errors import VoiceError


class SpeechProvider:
    def __init__(self, settings: Settings, transport=None):
        self.settings, self.transport = settings, transport

    async def _post(self, url, headers, **kwargs):
        try:
            async with asyncio.timeout(45), httpx.AsyncClient(timeout=45, follow_redirects=False, trust_env=False,
                                         transport=self.transport) as client:
                async with client.stream("POST", url, headers=headers, **kwargs) as response:
                    if response.status_code == 429:
                        raise VoiceError(429, "voice_quota", "Voice quota reached. Try again later.", 60)
                    if response.status_code in (401, 403):
                        raise VoiceError(503, "voice_credentials", "The voice provider rejected its server key or access.")
                    if response.status_code >= 300:
                        raise VoiceError(502, "voice_provider", "The voice provider could not complete the request.")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > 18 * 1024 * 1024:
                            raise VoiceError(502, "voice_provider", "The voice response was too large.")
                    return json.loads(data)
        except (httpx.TimeoutException, TimeoutError):
            raise VoiceError(504, "voice_timeout", "The voice provider timed out.") from None
        except (httpx.HTTPError, ValueError):
            raise VoiceError(502, "voice_provider", "The voice provider returned an invalid response.") from None

    async def transcribe(self, audio: bytes, language: str) -> str:
        if not self.settings.groq_key:
            raise VoiceError(503, "voice_unconfigured", "Set GROQ_API_KEY on the voice server.")
        data = await self._post("https://api.groq.com/openai/v1/audio/transcriptions",
            {"Authorization": f"Bearer {self.settings.groq_key}"},
            data={"model": self.settings.stt_model, "language": language,
                  "response_format": "verbose_json", "temperature": "0"},
            files={"file": ("question.wav", audio, "audio/wav")})
        if not isinstance(data, dict) or not isinstance(data.get("text"), str):
            raise VoiceError(502, "voice_provider", "The transcription response was invalid.")
        segments = data.get("segments", [])
        if isinstance(segments, list) and segments and all(isinstance(s, dict) and isinstance(s.get("no_speech_prob"), (int, float))
                and s["no_speech_prob"] > 0.8 for s in segments):
            return ""
        text = data["text"].strip()
        if len(text) > 8000:
            raise VoiceError(502, "voice_provider", "The transcription was too long.")
        return text

    async def synthesize(self, text: str, language: str) -> bytes:
        if not self.settings.gemini_key:
            raise VoiceError(503, "voice_unconfigured", "Set GEMINI_API_KEY on the voice server.")
        names = {"en": "English", "ar": "Modern Standard Arabic", "fr": "French"}
        data = await self._post("https://generativelanguage.googleapis.com/v1beta/interactions",
            {"x-goog-api-key": self.settings.gemini_key}, json={
                "model": self.settings.tts_model,
                "store": False,
                "input": [{"type": "user_input", "content": [{"type": "text", "text": text,
                    "annotations": [{"type": "speech_metadata", "style":
                        f"Speak clearly and calmly in {names[language]}. Read the text exactly as written."}]}]}],
                "response_format": {"type": "audio"},
                "generation_config": {"speech_config": [{"voice": self.settings.tts_voice}]},
            })
        try:
            encoded = [item["data"] for step in data["steps"] if step.get("type") == "model_output"
                       for item in step.get("content", []) if item.get("type") == "audio"][-1]
            result = base64.b64decode(encoded, validate=True)
            if len(result) > 12 * 1024 * 1024 or result[:4] != b"RIFF" or result[8:12] != b"WAVE":
                raise ValueError()
            return result
        except (KeyError, IndexError, TypeError, ValueError, AttributeError, binascii.Error):
            raise VoiceError(502, "voice_provider", "The speech provider did not return WAV audio.") from None
