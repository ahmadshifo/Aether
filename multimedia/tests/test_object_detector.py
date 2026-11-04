"""Vision request, parsing, and integration tests; no paid or network requests."""

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
import openai
import pytest
from openai import OpenAI
from openai.types.responses import Response

from processing import object_detector
from processing.frame_extractor import FrameExtractor
from processing.frame_selector import FrameSelector
from processing.image_utils import ImageEncodingError
from processing.object_detector import (
    DEFAULT_MODEL, VISUAL_INSTRUCTIONS, VisionAuthenticationError, VisionConfigurationError,
    VisionError, VisionIncompleteError, VisionModelError, VisionNetworkError,
    VisionRateLimitError, VisionRefusalError, VisionResponseError, VisionService,
    VisionTimeoutError, main, normalize_objects, parse_analysis,
)

pytestmark = pytest.mark.usefixtures("vision_offline")


def decode_image(data_url):
    assert data_url.startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    assert raw.startswith(b"\xff\xd8")
    return cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_UNCHANGED)


@pytest.mark.parametrize("layout", ["bgr", "gray", "bgra"])
def test_image_request_encoding_and_preservation(vision_image, vision_client, layout):
    image = vision_image
    if layout == "gray":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    elif layout == "bgra":
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        image[:, :, 3] = 0
    original = image.copy()
    image.flags.writeable = False
    result = VisionService(client=vision_client).analyze_image(image)
    request = vision_client.responses.create.call_args.kwargs
    content = request["input"][0]["content"]
    assert [item["type"] for item in content] == ["input_text", "input_image"]
    assert content[1]["detail"] == "high"
    decoded = decode_image(content[1]["image_url"])
    assert decoded.shape[:2] == image.shape[:2]
    assert decoded.ndim == (2 if layout == "gray" else 3)
    assert result.objects == ["chair", "table"]
    np.testing.assert_array_equal(image, original)


def test_exact_structured_request(vision_image, vision_client):
    result = VisionService(client=vision_client, model="custom-vision", timeout_seconds=12).analyze_image(vision_image)
    vision_client.with_options.assert_called_once_with(max_retries=0)
    vision_client.responses.create.assert_called_once()
    request = vision_client.responses.create.call_args.kwargs
    assert request["model"] == result.model == "custom-vision"
    assert request["instructions"] == VISUAL_INSTRUCTIONS
    assert request["store"] is False and request["timeout"] == 12
    assert request["max_output_tokens"] == 1024
    assert "tools" not in request
    format = request["text"]["format"]
    assert format["type"] == "json_schema" and format["strict"] is True
    schema = format["schema"]
    assert set(schema["required"]) == {"objects", "caption", "uncertain"}
    assert schema["additionalProperties"] is False
    assert schema["properties"]["objects"]["items"]["type"] == "string"
    assert schema["properties"]["caption"]["type"] == "string"
    assert schema["properties"]["uncertain"]["type"] == "boolean"


def test_normalization_is_lightweight_and_ordered():
    assert normalize_objects(["Chair", " table ", "chair", "Laptop", "", " ", "water bottle"]
                             ) == ["chair", "table", "laptop", "water bottle"]


@pytest.mark.parametrize("labels", [None, "chair", [1], ["chair", None]])
def test_invalid_normalization_inputs(labels):
    with pytest.raises(TypeError, match="list of strings"):
        normalize_objects(labels)


def test_response_normalization_unicode_and_reasoning_first(vision_client, vision_image, vision_response):
    vision_client.responses.create.return_value = vision_response({
        "objects": [" Chair ", "chair", "Café sign", "door sign", ""],
        "caption": "  A sign reads الغرفة ٢٠٥ beside a café.\nA chair is nearby.  ", "uncertain": True,
    }, reasoning=True)
    result = VisionService(client=vision_client).analyze_image(vision_image)
    assert result.objects == ["chair", "café sign", "door sign"]
    assert result.caption == "A sign reads الغرفة ٢٠٥ beside a café.\nA chair is nearby."
    assert result.uncertain is True


def test_empty_uncertain_result_is_success(vision_client, vision_image, vision_response):
    vision_client.responses.create.return_value = vision_response({"objects": [], "caption": "", "uncertain": True})
    result = VisionService(client=vision_client).analyze_image(vision_image)
    assert result.objects == [] and result.caption == "" and result.uncertain is True
    vision_client.responses.create.assert_called_once()


@pytest.mark.parametrize("payload", [
    {}, {"objects": [], "caption": "A room."},
    {"objects": "chair", "caption": "A chair.", "uncertain": False},
    {"objects": [1], "caption": "A room.", "uncertain": False},
    {"objects": [], "caption": None, "uncertain": False},
    {"objects": [], "caption": "", "uncertain": "false"},
    {"objects": [], "caption": "", "uncertain": 0},
    {"objects": [], "caption": "", "uncertain": False, "confidence": 0.9},
])
def test_invalid_structure_never_invents_defaults(vision_client, vision_image, vision_response, payload):
    vision_client.responses.create.return_value = vision_response(payload)
    with pytest.raises(VisionResponseError, match="invalid structured"):
        VisionService(client=vision_client).analyze_image(vision_image)


@pytest.mark.parametrize("raw", ["", "not JSON", "[]", "```json\n{}\n```"])
def test_empty_or_malformed_output(vision_response, raw):
    with pytest.raises(VisionResponseError):
        parse_analysis(vision_response(raw_text=raw), DEFAULT_MODEL)


def test_refusal_incomplete_and_missing_output(vision_response):
    with pytest.raises(VisionRefusalError):
        parse_analysis(vision_response(refusal=True), DEFAULT_MODEL)
    with pytest.raises(VisionIncompleteError):
        parse_analysis(vision_response(status="incomplete"), DEFAULT_MODEL)
    response = vision_response()
    response.output = []
    with pytest.raises(VisionResponseError):
        parse_analysis(response, DEFAULT_MODEL)


def test_failed_or_non_sdk_response(vision_response):
    with pytest.raises(VisionResponseError):
        parse_analysis({}, DEFAULT_MODEL)
    with pytest.raises(VisionResponseError):
        parse_analysis(vision_response(status="failed"), DEFAULT_MODEL)


@pytest.mark.parametrize("bad, exception", [
    (None, TypeError), ("image.png", TypeError), ([[0, 1]], TypeError),
    (np.empty((0, 4), dtype=np.uint8), ValueError),
    (np.zeros((4,), dtype=np.uint8), ValueError),
    (np.zeros((4, 4, 2), dtype=np.uint8), ValueError),
    (np.zeros((4, 4, 1), dtype=np.uint8), ValueError),
    (np.full((4, 4), np.nan), TypeError),
    (np.full((4, 4), np.inf), TypeError),
    (np.zeros((4, 4), dtype=np.uint16), TypeError),
])
def test_invalid_image_never_calls_api(vision_client, bad, exception):
    with pytest.raises(exception):
        VisionService(client=vision_client).analyze_image(bad)
    vision_client.responses.create.assert_not_called()


def test_encoding_failure_never_calls_api(vision_image, vision_client):
    with patch("processing.image_utils.cv2.imencode", return_value=(False, None)):
        with pytest.raises(ImageEncodingError):
            VisionService(client=vision_client).analyze_image(vision_image)
    vision_client.responses.create.assert_not_called()


def test_missing_key_lazy_client_and_owned_cleanup(vision_image, monkeypatch, vision_client):
    with patch("processing.object_detector.OpenAI") as factory:
        service = VisionService()
        factory.assert_not_called()
        with pytest.raises(VisionConfigurationError, match="OPENAI_API_KEY"):
            service.analyze_image(vision_image)
        factory.assert_not_called()
        monkeypatch.setenv("OPENAI_API_KEY", "offline-placeholder")
        factory.return_value.__enter__.return_value = vision_client
        owned = VisionService()
        factory.assert_not_called()
        owned.analyze_image(vision_image)
        factory.assert_called_once_with(api_key="offline-placeholder", timeout=30.0, max_retries=0)
        factory.return_value.__exit__.assert_called_once()


def test_environment_and_model_override(tmp_path, monkeypatch, vision_client):
    env = tmp_path / "config.env"
    env.write_text("OPENAI_API_KEY=offline-key\nOPENAI_VISION_MODEL=file-model\n"
                   "MISTRAL_API_KEY=other-key\nMISTRAL_OCR_MODEL=other-model\n", encoding="utf-8")
    monkeypatch.setattr(object_detector, "ENV_FILE", env)
    assert VisionService(client=vision_client).model == "file-model"
    monkeypatch.setenv("OPENAI_VISION_MODEL", "environment-model")
    assert VisionService(client=vision_client).model == "environment-model"
    assert VisionService(client=vision_client, model="override").model == "override"
    assert "OPENAI_API_KEY" not in __import__("os").environ


@pytest.mark.parametrize("model", ["", " ", 123])
def test_invalid_model(vision_client, model):
    with pytest.raises(VisionConfigurationError):
        VisionService(client=vision_client, model=model)


@pytest.mark.parametrize("timeout", [0, -1, 301, float("nan"), float("inf"), True, "30"])
def test_invalid_timeout(vision_client, timeout):
    with pytest.raises(VisionConfigurationError):
        VisionService(client=vision_client, timeout_seconds=timeout)


@pytest.mark.parametrize("status, sdk_type, expected", [
    (401, openai.AuthenticationError, VisionAuthenticationError),
    (403, openai.PermissionDeniedError, VisionAuthenticationError),
    (429, openai.RateLimitError, VisionRateLimitError),
    (404, openai.NotFoundError, VisionModelError),
    (400, openai.BadRequestError, VisionError),
    (503, openai.InternalServerError, VisionError),
])
def test_api_status_errors_safe_and_single_attempt(vision_client, vision_image, status, sdk_type, expected):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(status, request=request)
    vision_client.responses.create.side_effect = sdk_type(
        "secret provider details", response=response, body={"secret": "private payload"})
    with pytest.raises(expected) as caught:
        VisionService(client=vision_client).analyze_image(vision_image)
    trace = "".join(traceback.format_exception(caught.type, caught.value, caught.tb))
    assert "secret provider details" not in trace and "private payload" not in trace
    vision_client.responses.create.assert_called_once()


@pytest.mark.parametrize("kind, expected", [("timeout", VisionTimeoutError), ("network", VisionNetworkError)])
def test_transport_errors(vision_client, vision_image, kind, expected):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    error = openai.APITimeoutError(request=request) if kind == "timeout" else openai.APIConnectionError(request=request)
    vision_client.responses.create.side_effect = error
    with pytest.raises(expected):
        VisionService(client=vision_client).analyze_image(vision_image)
    vision_client.responses.create.assert_called_once()


def test_real_sdk_over_offline_transport(vision_image, vision_response):
    attempts = []

    def handle(request):
        attempts.append(request)
        payload = json.loads(request.content)
        assert payload["model"] == DEFAULT_MODEL
        assert decode_image(payload["input"][0]["content"][1]["image_url"]).shape == vision_image.shape
        assert payload["text"]["format"]["strict"] is True
        assert payload["store"] is False
        assert request.url.path == "/v1/responses"
        assert all(value == 30 for value in request.extensions["timeout"].values())
        return httpx.Response(200, json=vision_response().model_dump(mode="json"))

    with httpx.Client(transport=httpx.MockTransport(handle)) as transport:
        with OpenAI(api_key="offline-placeholder", http_client=transport) as client:
            result = VisionService(client=client).analyze_image(vision_image)
    assert len(attempts) == 1 and result.objects == ["chair", "table"]


def test_real_sdk_rate_limit_has_no_automatic_retry(vision_image):
    attempts = []

    def handle(request):
        attempts.append(request)
        return httpx.Response(429, json={"error": {"message": "private", "type": "rate_limit_error"}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as transport:
        with OpenAI(api_key="offline-placeholder", http_client=transport) as client:
            with pytest.raises(VisionRateLimitError):
                VisionService(client=client).analyze_image(vision_image)
    assert len(attempts) == 1


def test_selected_frame_and_ocr_coexistence(tmp_path, monkeypatch, vision_client):
    from processing import ocr_service
    from mistralai.client.models import OCRResponse, OCRUsageInfo
    from scripts.generate_selection_video import main as generate_video
    monkeypatch.setattr(ocr_service, "ENV_FILE", tmp_path / "absent.env")
    monkeypatch.delenv("MISTRAL_OCR_MODEL", raising=False)
    ocr_client = Mock()
    ocr_client.ocr.process.return_value = OCRResponse(pages=[], model="mistral-ocr-latest",
                                                    usage_info=OCRUsageInfo(pages_processed=0))
    ocr = ocr_service.OCRService(client=ocr_client)
    vision = VisionService(client=vision_client)
    path = tmp_path / "selected.avi"
    assert generate_video(["--output", str(path)]) == 0
    with FrameExtractor(path, max_frames=1) as extractor:
        for frame in extractor.extract_frames():
            before = (frame.source_video, frame.frame_index, frame.timestamp_ms, frame.captured_at)
            pixels = frame.frame.copy()
            assert FrameSelector().evaluate(frame).accepted
            vision.analyze_image(frame.frame)
            ocr_client.ocr.process.assert_not_called()
            ocr.extract_text(frame.frame)
            assert before == (frame.source_video, frame.frame_index, frame.timestamp_ms, frame.captured_at)
            np.testing.assert_array_equal(pixels, frame.frame)
    assert vision.model == DEFAULT_MODEL and ocr.model == "mistral-ocr-latest"
    vision_client.responses.create.assert_called_once()
    ocr_client.ocr.process.assert_called_once()


def test_cli_invalid_path_and_missing_key(tmp_path, vision_image, capsys):
    assert main(["--image", str(tmp_path / "missing.png")]) == 1
    assert "Image file not found" in capsys.readouterr().err
    path = tmp_path / "scene.png"
    assert cv2.imwrite(str(path), vision_image)
    assert main(["--image", str(path)]) == 1
    assert "OPENAI_API_KEY" in capsys.readouterr().err


def test_cli_valid_mocked_output_and_model_override(tmp_path, vision_image, vision_client, monkeypatch, capsys):
    path = tmp_path / "scene.png"
    assert cv2.imwrite(str(path), vision_image)
    monkeypatch.setenv("OPENAI_API_KEY", "offline-secret-key")
    with patch("processing.object_detector.OpenAI") as factory:
        factory.return_value.__enter__.return_value = vision_client
        assert main(["--image", str(path), "--model", "custom-model"]) == 0
    output = capsys.readouterr().out
    for text in ("- chair", "- table", "A chair is beside a table.", "Uncertain: No", "custom-model"):
        assert text in output
    assert "offline-secret-key" not in output and "data:image" not in output
    vision_client.responses.create.assert_called_once()


def test_import_and_initialization_have_no_requests(vision_client):
    with patch("processing.object_detector.OpenAI") as factory:
        VisionService(client=vision_client)
        factory.assert_not_called()
        vision_client.responses.create.assert_not_called()
    code = (
        "from unittest.mock import patch, Mock\n"
        "with patch('httpx.Client.send', side_effect=AssertionError('Unexpected network')):\n"
        "    import processing.object_detector as module\n"
        "    import processing.caption_service\n"
        "    module.VisionService(client=Mock())\n"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
