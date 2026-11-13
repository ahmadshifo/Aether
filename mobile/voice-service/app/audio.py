"""Bounded conversion; recordings and generated audio are never retained."""
import asyncio
import io
from pathlib import Path
import tempfile
import wave
from .errors import VoiceError

MAX_AUDIO = 4 * 1024 * 1024


def audio_format(data: bytes) -> str:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[4:8] == b"ftyp":
        return "mov"
    if data[:4] == b"\x1aE\xdf\xa3":
        return "matroska"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:3] == b"ID3" or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224:
        return "mp3"
    raise VoiceError(415, "voice_audio_format", "Use a WAV, M4A, MP3, Ogg, or WebM recording.")


async def convert(data: bytes, ffmpeg: str, *, mp3=False) -> bytes:
    if not data or len(data) > (12 * 1024 * 1024 if mp3 else MAX_AUDIO):
        raise VoiceError(413, "voice_audio_size", "The recording is empty or too large.")
    kind = audio_format(data)
    if mp3:
        try:
            with wave.open(io.BytesIO(data), 'rb') as audio:
                if not 0 < audio.getnframes() / audio.getframerate() <= 180:
                    raise ValueError()
        except (wave.Error, ValueError, EOFError):
            raise VoiceError(502, 'voice_provider', 'The provider returned invalid or excessively long speech.') from None
    with tempfile.TemporaryDirectory(prefix="aether-voice-") as folder:
        source, target = Path(folder) / "input", Path(folder) / ("out.mp3" if mp3 else "out.wav")
        source.write_bytes(data)
        options = ["-t", "180", "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-b:a", "64k"] if mp3 else ["-t", "31", "-ac", "1", "-ar", "16000", "-codec:a", "pcm_s16le"]
        try:
            process = await asyncio.create_subprocess_exec(ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                "-protocol_whitelist", "file,pipe", "-f", kind, "-i", str(source), "-vn", *options, "-y", str(target),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        except OSError:
            raise VoiceError(503, "voice_audio_unavailable", "FFmpeg is not available on the voice server.") from None
        try:
            await asyncio.wait_for(process.wait(), 15)
            if process.returncode or not target.exists():
                raise VoiceError(422, "voice_audio_invalid", "The recording could not be decoded.")
            if not mp3:
                with wave.open(str(target), "rb") as audio:
                    duration = audio.getnframes() / audio.getframerate()
                if not 0.15 <= duration <= 30:
                    raise VoiceError(422, "voice_audio_duration", "Record between 0.15 and 30 seconds.")
            return target.read_bytes()
        except TimeoutError:
            raise VoiceError(504, "voice_timeout", "Audio conversion timed out.") from None
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
