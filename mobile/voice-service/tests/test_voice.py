import asyncio
import base64
from dataclasses import replace
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
import wave

import httpx
import pytest
from fastapi.testclient import TestClient
from app.audio import convert
from app.config import Settings
from app.errors import VoiceError
from app.main import create_app
from app.security import BodyLimit


def wav(seconds=0.3):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\0\0" * int(16000 * seconds))
    return stream.getvalue()


@pytest.fixture
def setup():
    assert shutil.which("ffmpeg"), "Install FFmpeg before running audio integration tests"
    calls, auth_calls = [], []
    def upstream(request):
        calls.append(request)
        if request.url.host == "api.groq.com":
            return httpx.Response(200, json={"text": "أين الباب؟", "segments": []})
        return httpx.Response(200, json={"steps": [{"type": "model_output", "content": [
            {"type": "audio", "data": base64.b64encode(wav()).decode()}]}]})
    def auth(request):
        auth_calls.append(request)
        if request.headers.get("cookie") == "access=valid":
            return httpx.Response(200, json={"user": {"user_id": "user-one"}})
        return httpx.Response(401, json={"error": {"code": "not_authenticated"}})
    settings = Settings(groq_key="synthetic-groq-secret", gemini_key="synthetic-gemini-secret")
    app = create_app(settings, provider_transport=httpx.MockTransport(upstream), auth_transport=httpx.MockTransport(auth))
    with TestClient(app, headers={"X-Aether-Voice": "1", "Cookie": "access=valid"}) as client:
        yield client, app, calls, auth_calls


def test_health_truthful_and_secret_free(setup):
    client, _, calls, _ = setup
    response = client.get("/health")
    assert response.json()["configured"] is True
    assert response.json()["provider_verified"] is False
    assert "secret" not in response.text
    assert calls == []


@pytest.mark.parametrize("language", ["en", "ar", "fr"])
def test_real_wav_upload_language_and_utf8_contract(setup, language):
    client, _, calls, auth_calls = setup
    response = client.post("/api/v1/voice/transcribe", data={"language": language}, files={"audio": ("question.wav", wav(), "audio/wav")})
    assert response.status_code == 200, response.text
    assert response.json() == {"text": "أين الباب؟", "language": language}
    assert str(calls[0].url).endswith("/audio/transcriptions")
    assert b"whisper-large-v3" in calls[0].content
    assert (b'name="language"\r\n\r\n' + language.encode()) in calls[0].content
    assert calls[0].headers["authorization"] == "Bearer synthetic-groq-secret"
    assert "cookie" not in calls[0].headers
    assert auth_calls[0].url.path == "/api/v1/auth/me"


@pytest.mark.parametrize("language,text", [("en", "The door is ahead."), ("ar", "الباب أمامك."), ("fr", "La porte est devant vous.")])
def test_tts_exact_text_actual_mp3_conversion(setup, language, text):
    client, _, calls, _ = setup
    response = client.post("/api/v1/voice/synthesize", json={"text": text, "language": language})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"ID3")
    assert len(response.content) > 100
    payload = json.loads(calls[0].content)
    assert payload["input"][0]["content"][0]["text"] == text
    assert payload["model"] == "gemini-3.8-flash-tts"
    assert payload["store"] is False
    assert calls[0].headers["x-goog-api-key"] == "synthetic-gemini-secret"
    assert "key=" not in str(calls[0].url)
    assert "cookie" not in calls[0].headers


@pytest.mark.parametrize("headers,status", [({"Cookie": ""}, 401), ({"Cookie": "access=expired"}, 401),
    ({"X-Aether-Voice": ""}, 403), ({"Origin": "https://untrusted.example"}, 403)])
def test_no_provider_call_without_authorized_account_and_origin(setup, headers, status):
    client, _, calls, _ = setup
    response = client.post("/api/v1/voice/synthesize", headers=headers, json={"text": "Hello", "language": "en"})
    assert response.status_code == status
    assert calls == []


def test_auth_outage_is_not_authenticated_and_does_not_use_key(setup):
    client, app, calls, _ = setup
    app.state.auth_transport = httpx.MockTransport(lambda _: httpx.Response(503))
    response = client.post("/api/v1/voice/synthesize", json={"text": "Hello", "language": "en"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "voice_auth_unavailable"
    assert calls == []


def test_missing_keys_is_actionable_not_fake_audio(setup):
    client, app, calls, _ = setup
    app.state.provider.settings = replace(app.state.settings, gemini_key="")
    response = client.post("/api/v1/voice/synthesize", json={"text": "Hello", "language": "en"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "voice_unconfigured"
    assert calls == []


@pytest.mark.parametrize("status,expected", [(429, 429), (401, 503), (403, 503), (500, 502), (302, 502)])
def test_provider_error_sanitized_no_retries(setup, status, expected):
    client, app, _, _ = setup
    seen = []
    def fail(request):
        seen.append(request)
        return httpx.Response(status, text="sensitive-provider-debug-secret")
    app.state.provider.transport = httpx.MockTransport(fail)
    response = client.post("/api/v1/voice/synthesize", json={"text": "Hello", "language": "en"})
    assert response.status_code == expected
    assert "secret" not in response.text
    assert len(seen) == 1
    if status == 429:
        assert response.headers["retry-after"] == "60"


@pytest.mark.parametrize("payload", [{"text": "", "language": "en"}, {"text": "   ", "language": "ar"},
    {"text": "Hello", "language": "de"}, {"text": "a" * 1201, "language": "en"},
    {"text": "Hello", "language": "en", "api_key": "injected"}])
def test_bad_text_never_reaches_provider(setup, payload):
    client, _, calls, _ = setup
    assert client.post("/api/v1/voice/synthesize", json=payload).status_code == 422
    assert calls == []


def test_bad_audio_and_oversized_body_never_reach_provider(setup):
    client, _, calls, _ = setup
    response = client.post("/api/v1/voice/transcribe", data={"language": "en"}, files={"audio": ("file.wav", b"#EXTM3U\nhttps://example.com")})
    assert response.status_code == 415
    response = client.post("/api/v1/voice/transcribe", content=b"x" * (4 * 1024 * 1024 + 9000))
    assert response.status_code == 413
    assert calls == []


def test_duration_limit_and_audio_roundtrip():
    with pytest.raises(VoiceError) as error:
        asyncio.run(convert(wav(31), "ffmpeg"))
    assert error.value.code == "voice_audio_duration"
    mp3 = asyncio.run(convert(wav(), "ffmpeg", mp3=True))
    normalized = asyncio.run(convert(mp3, "ffmpeg"))
    with wave.open(io.BytesIO(normalized)) as audio:
        assert audio.getframerate() == 16000 and audio.getnchannels() == 1


def test_chunked_upload_limit_before_parser():
    called, sent = [], []
    async def downstream(*_):
        called.append(True)
    chunks = iter([{"type": "http.request", "body": b"123456", "more_body": True},
                   {"type": "http.request", "body": b"123456", "more_body": False}])
    async def receive():
        return next(chunks)
    async def send(message):
        sent.append(message)
    asyncio.run(BodyLimit(downstream, limit=10)({"type": "http", "method": "POST"}, receive, send))
    assert not called
    assert sent[0]["status"] == 413


def test_provider_no_speech_and_bad_audio(setup):
    _, app, _, _ = setup
    app.state.provider.transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"text": "Thank you", "segments": [{"no_speech_prob": 0.99}]}))
    assert asyncio.run(app.state.provider.transcribe(wav(), "en")) == ""
    app.state.provider.transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"steps": []}))
    with pytest.raises(VoiceError):
        asyncio.run(app.state.provider.synthesize("Hello", "en"))


def test_actual_m4a_from_phone_format_is_decoded_and_tempfiles_are_removed():
    before = set(Path(tempfile.gettempdir()).glob('aether-voice-*'))
    with tempfile.TemporaryDirectory() as directory:
        source, target = Path(directory) / 'input.wav', Path(directory) / 'phone.m4a'
        source.write_bytes(wav())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(source), '-codec:a', 'aac', str(target)], check=True)
        normalized = asyncio.run(convert(target.read_bytes(), 'ffmpeg'))
        assert normalized[:4] == b'RIFF'
    assert set(Path(tempfile.gettempdir()).glob('aether-voice-*')) == before


def test_per_account_limit_returns_retry_after_without_extra_provider_call(setup):
    client, app, _, _ = setup
    app.state.provider.settings = replace(app.state.settings, gemini_key='')
    for _ in range(10):
        assert client.post('/api/v1/voice/synthesize', json={'text': 'Hello', 'language': 'en'}).status_code == 503
    response = client.post('/api/v1/voice/synthesize', json={'text': 'Hello', 'language': 'en'})
    assert response.status_code == 429 and response.headers['retry-after'] == '60'
    assert app.state.quota.active == 0
