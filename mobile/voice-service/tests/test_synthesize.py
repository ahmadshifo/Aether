"""In-memory endpoint contract checks. Model inference is stubbed in unit tests."""
import io
import wave
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import routes
from app.speech_provider import VoiceError, LocalVoice

client = TestClient(app, raise_server_exceptions=False)

def wav():
    out = io.BytesIO()
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 1600)
    return out.getvalue()

@pytest.mark.parametrize("lang,text", [("en", "Hello"), ("ar", "مرحبا"), ("fr", "Bonjour")])
def test_tts_wav(lang, text):
    with patch.object(routes.provider, "tts", return_value=wav()) as tts:
        response = client.post("/api/v1/voice/tts", json={"text": text, "lang": lang})
        assert response.status_code == 200
        assert response.content[:4] == b"RIFF"
        assert response.headers["content-type"] == "audio/wav"
        assert response.headers["cache-control"] == "no-store"
        tts.assert_called_once_with(text, lang, 1.0)

@pytest.mark.parametrize("body", [{"text": ""}, {"text": "  "}, {"text": "x", "lang": "zz"}, {"text": "x", "speed": 5}, {"text": "x" * 2001}])
def test_validation(body):
    result = client.post("/api/v1/voice/tts", json=body)
    assert result.status_code == 422
    assert set(result.json()["error"]) == {"code", "message"}

def test_legacy_dashboard():
    with patch.object(routes.provider, "tts", return_value=wav()):
        response = client.post("/api/v1/voice/synthesize", json={"text": "Bonjour", "language": "fr"})
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"

@pytest.mark.parametrize("lang", ["en", "ar", "fr"])
@pytest.mark.parametrize("multipart", [False, True])
def test_stt(lang, multipart):
    with patch.object(routes.provider, "role", "stt"), patch.object(routes.provider, "stt", return_value="question") as stt:
        if multipart:
            result = client.post("/api/v1/voice/stt", data={"lang": lang}, files={"audio": ("speech.wav", wav(), "audio/wav")})
        else:
            result = client.post("/api/v1/voice/stt?lang=" + lang, content=wav(), headers={"Content-Type": "audio/wav"})
        assert result.status_code == 200
        assert result.json() == {"text": "question", "lang": lang}
        stt.assert_called_once_with(wav(), lang)

def test_no_multipart_spool():
    # A multipart payload above Starlette's ordinary spool threshold still uses RAM.
    import tempfile
    data = b"z" * (1024 * 1024 + 100)
    with patch("tempfile.SpooledTemporaryFile", side_effect=AssertionError("audio must stay in RAM")), \
         patch.object(routes.provider, "role", "stt"), patch.object(routes.provider, "stt", return_value=""):
        result = client.post("/api/v1/voice/stt", files={"audio": ("a.wav", data, "audio/wav")}, data={"lang": "en"})
        assert result.status_code == 200

def test_oversized_and_bad_media():
    assert client.post("/api/v1/voice/stt", content=b"x" * (routes.MAX_BODY + 1)).status_code == 413
    assert client.post("/api/v1/voice/stt", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/api/v1/voice/stt?lang=zz", content=b"x", headers={"Content-Type": "audio/wav"}).status_code == 422

def test_failed_and_busy():
    for code, status in [("voice_busy", 429), ("voice_unavailable", 503)]:
        with patch.object(routes.provider, "tts", side_effect=VoiceError(code, "Try again.", status)):
            result = client.post("/api/v1/voice/tts", json={"text": "hello"})
            assert result.status_code == status
            assert result.json()["error"]["code"] == code

def test_health_loading_and_ready():
    with patch.object(routes.provider, "role", "stt"), patch.object(routes.provider, "model", None):
        assert client.get("/api/v1/voice/health").status_code == 503
    with patch.object(routes.provider, "role", "stt"), patch.object(routes.provider, "model", object()):
        result = client.get("/api/v1/voice/health")
        assert result.status_code == 200
        assert result.json()["audio_storage"] == "memory_only"

def test_bad_audio_never_reaches_model():
    voice = LocalVoice()
    with pytest.raises(VoiceError) as error:
        voice.stt(b"not a recording", "ar")
    assert error.value.code == "invalid_audio"

def test_duration_limit():
    out = io.BytesIO()
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 336000)
    with pytest.raises(VoiceError) as error:
        LocalVoice().stt(out.getvalue(), "en")
    assert error.value.code == "audio_too_long"
