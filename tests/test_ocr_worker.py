"""HTTP and confidence boundary tests without model downloads or user images."""
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from PIL import Image

spec = importlib.util.spec_from_file_location('ocr_worker', Path(__file__).parents[1] / 'multimedia/ocr-service/app.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(worker, 'failed', False)
    fake = SimpleNamespace(predict=lambda image, **kw: [{'rec_texts': ['EXIT'], 'rec_scores': [.99]}])
    monkeypatch.setattr(worker, 'models', dict.fromkeys(['en', 'ar', 'fr'], fake))
    # Without entering the context, model download lifespan does not run.
    return TestClient(worker.app)

def picture():
    output = io.BytesIO(); Image.new('RGB', (120, 80), 'white').save(output, format='PNG')
    return output.getvalue()

@pytest.mark.parametrize('language', ['en', 'ar', 'fr'])
def test_language_and_memory_response(client, language):
    response = client.post('/api/v1/ocr?lang='+language, content=picture())
    assert response.status_code == 200
    assert response.json()['text'] == 'EXIT'
    assert response.headers['cache-control'] == 'no-store'

@pytest.mark.parametrize('texts,scores,status', [(['legible', 'guess'], [.99,.2], 'unclear'), ([], [], 'no_text')])
def test_no_partial_or_invented_text(client, texts, scores, status):
    worker.models['en'].predict = lambda image, **kw: [{'rec_texts': texts, 'rec_scores': scores}]
    body = client.post('/api/v1/ocr', content=picture()).json()
    assert body['status'] == status
    assert body['text'] == body['raw_markdown'] == '' and body['has_text'] is False

def test_invalid_language_image_and_size(client):
    assert client.post('/api/v1/ocr?lang=zz', content=picture()).status_code == 422
    assert client.post('/api/v1/ocr', content=b'not an image').status_code == 422
    assert client.post('/api/v1/ocr', content=b'x'*(4*1024*1024+1)).status_code == 413

def test_busy_and_unready_are_not_no_text(client, monkeypatch):
    worker.lock.acquire()
    try: assert client.post('/api/v1/ocr', content=picture()).status_code == 429
    finally: worker.lock.release()
    monkeypatch.setattr(worker, 'models', {})
    assert client.get('/health').status_code == 503
    assert client.post('/api/v1/ocr', content=picture()).status_code == 503
