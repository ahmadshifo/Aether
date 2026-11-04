"""Offline OCR tests at the SDK/request boundary; no real credentials or network."""

import base64
import json
import subprocess
import sys
import traceback
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import httpx
import numpy as np
import pytest
from mistralai.client import Mistral, errors
from mistralai.client.models import OCRPageObject, OCRResponse, OCRUsageInfo

from processing import ocr_service
from processing.frame_extractor import FrameExtractor
from processing.frame_selector import FrameSelector
from processing.ocr_service import (
    DEFAULT_MODEL, ImageEncodingError, OCRAuthenticationError, OCRConfigurationError,
    OCRNetworkError, OCRRateLimitError, OCRResponseError, OCRService,
    OCRServiceError, OCRTimeoutError, encode_jpeg, image_to_data_url, main, parse_response,
)


@pytest.fixture(autouse=True)
def offline_environment(monkeypatch, tmp_path):
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    monkeypatch.delenv("MISTRAL_OCR_MODEL", raising=False)
    monkeypatch.setattr(ocr_service, "ENV_FILE", tmp_path / "absent.env")

    def forbid_network(*args, **kwargs):
        raise AssertionError("Unit tests must never use a real HTTP transport")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid_network)


def sdk_response(*texts, model=DEFAULT_MODEL):
    return OCRResponse(
        pages=[OCRPageObject(index=index, markdown=text, images=[], dimensions=None)
               for index, text in enumerate(texts)],
        model=model, usage_info=OCRUsageInfo(pages_processed=len(texts)),
    )


@pytest.fixture
def fake_client():
    client = Mock()
    client.ocr.process.return_value = sdk_response("ROOM 205")
    return client


@pytest.fixture
def image():
    image = np.full((100, 320, 3), 255, dtype=np.uint8)
    cv2.putText(image, "ROOM 205", (10, 65), cv2.FONT_HERSHEY_SIMPLEX,
                1.4, (0, 0, 0), 3)
    return image


def decode_data_url(data_url):
    assert data_url.startswith("data:image/jpeg;base64,")
    data = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    assert data.startswith(b"\xff\xd8")
    return cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)


@pytest.mark.parametrize("layout", ["bgr", "gray", "bgra"])
def test_encoding_and_input_preservation(image, layout):
    if layout == "gray":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    elif layout == "bgra":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        image[:, :, 3] = 0
    before = image.copy()
    image.flags.writeable = False
    decoded = decode_data_url(image_to_data_url(image))
    assert decoded is not None and decoded.shape[:2] == (100, 320)
    assert decoded.ndim == (2 if layout == "gray" else 3)
    np.testing.assert_array_equal(image, before)


def test_bgr_jpeg_preserves_color():
    blue = np.zeros((24, 24, 3), dtype=np.uint8)
    blue[:, :, 0] = 255
    decoded = cv2.imdecode(np.frombuffer(encode_jpeg(blue), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded[:, :, 0].mean() > 245
    assert decoded[:, :, 1:].mean() < 5


@pytest.mark.parametrize("bad, exception", [
    (None, TypeError), ("image.png", TypeError), ([[0, 1]], TypeError),
    (np.empty((0, 4), dtype=np.uint8), ValueError),
    (np.zeros((4,), dtype=np.uint8), ValueError),
    (np.zeros((4, 4, 2), dtype=np.uint8), ValueError),
    (np.zeros((4, 4, 1), dtype=np.uint8), ValueError),
    (np.zeros((2, 2, 2, 3), dtype=np.uint8), ValueError),
    (np.full((4, 4), np.nan), TypeError), (np.full((4, 4), np.inf), TypeError),
    (np.full((4, 4), -1, dtype=np.int16), TypeError),
])
def test_invalid_images_never_call_api(fake_client, bad, exception):
    with pytest.raises(exception):
        OCRService(client=fake_client).extract_text(bad)
    fake_client.ocr.process.assert_not_called()


@pytest.mark.parametrize("encoded", [(False, None), (True, np.array([], dtype=np.uint8))])
def test_jpeg_encoding_failure(image, fake_client, encoded):
    with patch("processing.ocr_service.cv2.imencode", return_value=encoded):
        with pytest.raises(ImageEncodingError, match="JPEG"):
            OCRService(client=fake_client).extract_text(image)
    fake_client.ocr.process.assert_not_called()


def test_jpeg_encoder_exception_is_controlled(image):
    with patch("processing.ocr_service.cv2.imencode", side_effect=cv2.error("encoder details")):
        with pytest.raises(ImageEncodingError, match="JPEG"):
            encode_jpeg(image)


def test_exact_sdk_request_and_text_result(image, fake_client):
    service = OCRService(client=fake_client, model="custom-ocr", timeout_seconds=12)
    result = service.extract_text(image)
    fake_client.ocr.process.assert_called_once()
    request = fake_client.ocr.process.call_args.kwargs
    assert request["model"] == "custom-ocr"
    assert request["document"]["type"] == "image_url"
    assert decode_data_url(request["document"]["image_url"]).shape == image.shape
    assert request["include_image_base64"] is False
    assert request["retries"] is None
    assert request["timeout_ms"] == 12000
    assert result.text == "ROOM 205" and result.has_text
    assert result.model == DEFAULT_MODEL  # Provider-reported model, not a guessed alias.


@pytest.mark.parametrize("text", [
    "ROOM 205", "SECOND FLOOR\nROOM 205\nCOMPUTER LAB",
    "الغرفة ٢٠٥\nمختبر الحاسوب", "Café Étage 2\n2026-11-02\n+961 1 234 567",
    "# ROOM 205\n\n**EXIT**",
])
def test_exact_multilingual_and_multiline_text(image, fake_client, text):
    fake_client.ocr.process.return_value = sdk_response(text)
    result = OCRService(client=fake_client).extract_text(image)
    assert result.text == text and result.raw_markdown == text
    assert result.has_text is True


@pytest.mark.parametrize("texts", [(), ("",), (" \n\t",), ("", "")])
def test_successful_empty_text(image, fake_client, texts):
    fake_client.ocr.process.return_value = sdk_response(*texts)
    result = OCRService(client=fake_client).extract_text(image)
    assert result.text == "" and result.has_text is False
    fake_client.ocr.process.assert_called_once()


def test_page_order_and_raw_markdown_preserved():
    response = sdk_response("  SECOND FLOOR\nROOM 205", "COMPUTER LAB  ")
    response.pages[0].index, response.pages[1].index = 7, 2
    result = parse_response(response)
    assert result.raw_markdown == "  SECOND FLOOR\nROOM 205\n\nCOMPUTER LAB  "
    assert result.text == "SECOND FLOOR\nROOM 205\n\nCOMPUTER LAB"


@pytest.mark.parametrize("response", [
    None, {}, {"pages": []},
    OCRResponse.model_construct(pages=[], model=DEFAULT_MODEL),
    OCRResponse.model_construct(pages=[{"markdown": 123}], model=DEFAULT_MODEL,
                                usage_info=OCRUsageInfo(pages_processed=1)),
])
def test_malformed_responses_are_failures(image, fake_client, response):
    fake_client.ocr.process.return_value = response
    with pytest.raises(OCRResponseError, match="invalid OCR response"):
        OCRService(client=fake_client).extract_text(image)


def test_missing_key_only_blocks_real_requests(image, fake_client):
    with patch("processing.ocr_service.Mistral") as factory:
        service = OCRService()
        factory.assert_not_called()
        with pytest.raises(OCRConfigurationError, match="MISTRAL_API_KEY is missing"):
            service.extract_text(image)
        factory.assert_not_called()
    assert OCRService(client=fake_client).extract_text(image).text == "ROOM 205"


def test_env_file_and_environment_precedence(tmp_path, monkeypatch, fake_client):
    env = tmp_path / "local.env"
    env.write_text("MISTRAL_API_KEY=offline-file-key\nMISTRAL_OCR_MODEL=file-model\n", encoding="utf-8")
    monkeypatch.setattr(ocr_service, "ENV_FILE", env)
    assert OCRService(client=fake_client).model == "file-model"
    monkeypatch.setenv("MISTRAL_OCR_MODEL", "environment-model")
    assert OCRService(client=fake_client).model == "environment-model"
    assert OCRService(client=fake_client, model="override-model").model == "override-model"
    assert "MISTRAL_API_KEY" not in __import__("os").environ  # No global dotenv mutation.


@pytest.mark.parametrize("model", ["", "  ", 42])
def test_invalid_model(model, fake_client):
    with pytest.raises(OCRConfigurationError, match="model identifier"):
        OCRService(client=fake_client, model=model)


@pytest.mark.parametrize("timeout", [0, -1, 301, float("nan"), float("inf"), True, "30"])
def test_invalid_timeout(timeout, fake_client):
    with pytest.raises(OCRConfigurationError, match="timeout_seconds"):
        OCRService(client=fake_client, timeout_seconds=timeout)


@pytest.mark.parametrize("status, exception, message", [
    (401, OCRAuthenticationError, "authentication"),
    (403, OCRAuthenticationError, "authentication"),
    (429, OCRRateLimitError, "rate limit"), (402, OCRServiceError, "billing"),
    (400, OCRServiceError, "HTTP 400"), (503, OCRServiceError, "HTTP 503"),
])
def test_provider_errors_sanitized_without_retries(image, fake_client, status, exception, message):
    secret = "offline-secret-never-display"
    response = httpx.Response(status, text=secret)
    fake_client.ocr.process.side_effect = errors.SDKError(secret, response)
    with pytest.raises(exception, match=message) as caught:
        OCRService(client=fake_client).extract_text(image)
    assert secret not in "".join(traceback.format_exception(caught.type, caught.value, caught.tb))
    fake_client.ocr.process.assert_called_once()


@pytest.mark.parametrize("error, exception", [
    (httpx.ConnectError("secret connection details"), OCRNetworkError),
    (httpx.ReadTimeout("secret timeout details"), OCRTimeoutError),
    (RuntimeError("secret unexpected details"), OCRServiceError),
])
def test_transport_errors_are_controlled(image, fake_client, error, exception):
    fake_client.ocr.process.side_effect = error
    with pytest.raises(exception) as caught:
        OCRService(client=fake_client).extract_text(image)
    assert "secret" not in str(caught.value)
    fake_client.ocr.process.assert_called_once()


def test_real_sdk_serialization_and_parsing_over_offline_transport(image):
    requests = []

    def handle(request):
        requests.append(request)
        payload = json.loads(request.content)
        assert payload["model"] == DEFAULT_MODEL
        assert payload["document"]["type"] == "image_url"
        assert decode_data_url(payload["document"]["image_url"]).shape == image.shape
        assert payload["include_image_base64"] is False
        assert request.url.path == "/v1/ocr"
        assert all(value == 30 for value in request.extensions["timeout"].values())
        return httpx.Response(200, json=sdk_response("ROOM 205").model_dump(mode="json"))

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        with Mistral(api_key="offline-test-key", client=http_client) as client:
            result = OCRService(client=client).extract_text(image)
    assert len(requests) == 1
    assert result.text == "ROOM 205"


@pytest.mark.parametrize("status, exception", [(429, OCRRateLimitError), (401, OCRAuthenticationError)])
def test_sdk_http_errors_make_one_attempt(image, status, exception):
    attempts = []

    def handle(request):
        attempts.append(request)
        return httpx.Response(status, json={"message": "private provider body"})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        with Mistral(api_key="offline-test-key", client=http_client) as client:
            with pytest.raises(exception):
                OCRService(client=client).extract_text(image)
    assert len(attempts) == 1


def test_sdk_invalid_json_is_not_a_successful_empty_result(image):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"pages": "invalid"}))
    with httpx.Client(transport=transport) as http_client:
        with Mistral(api_key="offline-test-key", client=http_client) as client:
            with pytest.raises(OCRResponseError):
                OCRService(client=client).extract_text(image)


def test_owned_client_is_lazy_and_closed(image, monkeypatch, fake_client):
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-test-key")
    with patch("processing.ocr_service.Mistral") as factory:
        factory.return_value.__enter__.return_value = fake_client
        service = OCRService()
        factory.assert_not_called()
        service.extract_text(image)
        factory.assert_called_once_with(api_key="offline-test-key", timeout_ms=30000, retry_config=None)
        factory.return_value.__exit__.assert_called_once()


def test_import_and_construction_make_no_requests(fake_client):
    with patch("processing.ocr_service.Mistral") as factory:
        OCRService(client=fake_client)
        factory.assert_not_called()
        fake_client.ocr.process.assert_not_called()
    code = (
        "from unittest.mock import patch, Mock\n"
        "with patch('httpx.Client.send', side_effect=AssertionError('Unexpected network')):\n"
        "    import processing.ocr_service as module\n"
        "    module.OCRService(client=Mock())\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                            cwd=Path(__file__).resolve().parents[1])
    assert result.returncode == 0, result.stderr


def test_selected_extracted_frame_compatibility(tmp_path, fake_client):
    from scripts.generate_selection_video import main as generate_video
    path = tmp_path / "selected.avi"
    assert generate_video(["--output", str(path)]) == 0
    selector = FrameSelector()
    service = OCRService(client=fake_client)
    with FrameExtractor(path, max_frames=1) as extractor:
        for extracted in extractor.extract_frames():
            metadata = (extracted.source_video, extracted.frame_index, extracted.timestamp_ms, extracted.captured_at)
            pixels = extracted.frame.copy()
            assert selector.evaluate(extracted).accepted
            assert service.extract_text(extracted.frame).text == "ROOM 205"
            assert metadata == (extracted.source_video, extracted.frame_index, extracted.timestamp_ms, extracted.captured_at)
            np.testing.assert_array_equal(extracted.frame, pixels)
    fake_client.ocr.process.assert_called_once()


def test_cli_invalid_path(tmp_path, capsys):
    assert main(["--image", str(tmp_path / "missing.png")]) == 1
    assert "Image file not found" in capsys.readouterr().err


def test_cli_missing_key(tmp_path, image, capsys):
    path = tmp_path / "sign.png"
    assert cv2.imwrite(str(path), image)
    assert main(["--image", str(path)]) == 1
    assert "MISTRAL_API_KEY is missing" in capsys.readouterr().err


@pytest.mark.parametrize("text", ["ROOM 205", ""])
def test_cli_with_mocked_sdk(tmp_path, image, capsys, monkeypatch, fake_client, text):
    path = tmp_path / "sign.png"
    assert cv2.imwrite(str(path), image)
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-secret-key")
    fake_client.ocr.process.return_value = sdk_response(text)
    with patch("processing.ocr_service.Mistral") as factory:
        factory.return_value.__enter__.return_value = fake_client
        assert main(["--image", str(path), "--model", "custom-model"]) == 0
    output = capsys.readouterr().out
    assert ("ROOM 205" if text else "No text detected.") in output
    assert "OCR completed successfully" in output
    assert "data:image" not in output and "offline-secret-key" not in output
    assert fake_client.ocr.process.call_args.kwargs["model"] == "custom-model"
    fake_client.ocr.process.assert_called_once()


def test_cli_failure_never_exposes_provider_details(tmp_path, image, monkeypatch, fake_client, capsys):
    path = tmp_path / "sign.png"
    assert cv2.imwrite(str(path), image)
    monkeypatch.setenv("MISTRAL_API_KEY", "offline-secret-key")
    fake_client.ocr.process.side_effect = errors.SDKError(
        "offline-secret-key", httpx.Response(401, text="offline-secret-key"))
    with patch("processing.ocr_service.Mistral") as factory:
        factory.return_value.__enter__.return_value = fake_client
        assert main(["--image", str(path)]) == 1
    captured = capsys.readouterr()
    assert "authentication" in captured.err
    assert "offline-secret-key" not in captured.err + captured.out
