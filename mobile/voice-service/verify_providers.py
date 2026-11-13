"""Explicit live smoke test: three synthetic phrases, no personal recordings or DB writes."""
import argparse
import asyncio
from app.audio import convert
from app.config import Settings
from app.errors import VoiceError
from app.speech_provider import SpeechProvider


async def verify():
    config = Settings.load()
    if not config.groq_key or not config.gemini_key or not config.audio_ready:
        raise SystemExit("Missing API keys or FFmpeg. Run setup_keys.py --check.")
    provider = SpeechProvider(config)
    for language, text in [("en", "The door is in front of you."), ("ar", "الباب أمامك."), ("fr", "La porte est devant vous.")]:
        try:
            wav = await provider.synthesize(text, language)
            normalized = await convert(wav, config.ffmpeg)
            transcription = await provider.transcribe(normalized, language)
            if not transcription:
                raise VoiceError(502, "voice_empty", "No transcription returned.")
            print(f"{language}: TTS audio received; STT returned: {transcription}")
        except VoiceError as error:
            raise SystemExit(f"{language}: {error.code}: {error.message}") from None
    print("Provider round trips passed. Listen on the iPhone to verify voice quality and microphone behavior.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True, help="Uses free-tier quota; only use accounts with billing disabled")
    parser.parse_args()
    asyncio.run(verify())
