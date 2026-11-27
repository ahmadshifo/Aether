"""Voice proxy authentication, body bounds and error handling without inference."""
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app.main import app
from app.auth import signed_in_user_id

client = TestClient(app)

def test_voice_requires_login():
    assert client.post('/api/v1/voice/tts', json={'text': 'hello', 'lang': 'en'}).status_code == 401

def test_voice_bounds_and_operations():
    app.dependency_overrides[signed_in_user_id] = lambda: 'voice-test'
    try:
        assert client.post('/api/v1/voice/stt', content=b'x' * (2 * 1024 * 1024 + 1)).status_code == 413
        assert client.get('/api/v1/voice/tts').status_code == 405
        assert client.get('/api/v1/voice/nope').status_code == 404
        with patch('app.voice.httpx.AsyncClient', side_effect=httpx.ConnectError('offline')):
            response = client.post('/api/v1/voice/tts', json={'text': 'hello', 'lang': 'en'})
            assert response.status_code == 503
            assert response.json()['error']['code'] == 'voice_unavailable'
    finally:
        app.dependency_overrides.pop(signed_in_user_id, None)
