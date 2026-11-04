"""Offline text preparation, SDK-boundary embeddings, and cosine tests."""

import json
import subprocess
import sys
import traceback
from dataclasses import asdict
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import numpy as np
import openai
import pytest
from dotenv import dotenv_values
from openai import OpenAI
from openai.types import CreateEmbeddingResponse, Embedding
from openai.types.create_embedding_response import Usage

from processing import embedding_service
from processing.embedding_service import (
    DEFAULT_MODEL, EXPECTED_DIMENSIONS, MAX_INPUT_BYTES, EmbeddingAuthenticationError,
    EmbeddingConfigurationError, EmbeddingNetworkError, EmbeddingRateLimitError,
    EmbeddingResponseError, EmbeddingService, EmbeddingServiceError, EmbeddingTimeoutError,
    build_frame_description, cosine_similarity, main, parse_embedding_response, validate_text,
)


@pytest.fixture(autouse=True)
def offline_environment(monkeypatch, tmp_path):
    for name in ("OPENAI_API_KEY", "OPENAI_EMBEDDING_MODEL", "OPENAI_EMBEDDING_DIMENSIONS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(embedding_service, "ENV_FILE", tmp_path / "absent.env")

    def forbid_network(*args, **kwargs):
        raise AssertionError("Embedding tests must not use real HTTP transport")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbid_network)


def sdk_response(vector=None, model=DEFAULT_MODEL):
    if vector is None:
        vector = np.linspace(-0.5, 0.5, EXPECTED_DIMENSIONS).tolist()
    return CreateEmbeddingResponse(
        data=[Embedding(embedding=vector, index=0, object="embedding")],
        model=model, object="list", usage=Usage(prompt_tokens=5, total_tokens=5),
    )


@pytest.fixture
def client():
    client = Mock()
    client.with_options.return_value = client
    client.embeddings.create.return_value = sdk_response()
    return client


def test_full_description_exact_order_and_preservation():
    objects = [" Door ", "sign", "door", "Wall", ""]
    original = objects.copy()
    description = build_frame_description("  ROOM 205\nSECOND FLOOR  ", objects,
                                          "  A wooden door in a corridor.  ")
    assert description == ("Scene: A wooden door in a corridor.\nObjects: door, sign, wall\n"
                           "Visible text: ROOM 205\nSECOND FLOOR")
    assert objects == original
    assert description == build_frame_description("  ROOM 205\nSECOND FLOOR  ", objects,
                                                   "  A wooden door in a corridor.  ")


@pytest.mark.parametrize("arguments, expected", [
    ({"ocr_text": " EXIT "}, "Visible text: EXIT"),
    ({"objects": [" Chair", "table", "chair"]}, "Objects: chair, table"),
    ({"caption": "A desk."}, "Scene: A desk."),
    ({"ocr_text": "الغرفة ٢٠٥\nمختبر الحاسوب"}, "Visible text: الغرفة ٢٠٥\nمختبر الحاسوب"),
    ({}, ""), ({"ocr_text": " \n", "objects": ["", " "], "caption": None}, ""),
])
def test_partial_metadata(arguments, expected):
    assert build_frame_description(**arguments) == expected


@pytest.mark.parametrize("arguments", [
    {"ocr_text": 123}, {"caption": []}, {"objects": "chair"}, {"objects": [1]},
])
def test_invalid_metadata(arguments):
    with pytest.raises(TypeError):
        build_frame_description(**arguments)


def test_empty_metadata_skips_without_key_or_client_request(client):
    with patch("processing.embedding_service.OpenAI") as factory:
        assert EmbeddingService().embed_frame() is None
        factory.assert_not_called()
    assert EmbeddingService(client=client).embed_frame(" ", [], "") is None
    client.embeddings.create.assert_not_called()


def test_correct_request_and_valid_result(client):
    result = EmbeddingService(client=client).embed_frame("ROOM 205", ["door", "sign"], "A door.")
    expected = "Scene: A door.\nObjects: door, sign\nVisible text: ROOM 205"
    client.with_options.assert_called_once_with(max_retries=0)
    client.embeddings.create.assert_called_once_with(
        model=DEFAULT_MODEL, input=expected, dimensions=1536, encoding_format="float", timeout=30.0)
    assert result.source_text == expected and result.model == DEFAULT_MODEL
    assert result.dimensions == len(result.embedding) == 1536
    assert all(type(value) is float and np.isfinite(value) for value in result.embedding)
    assert result.embedding == client.embeddings.create.return_value.data[0].embedding
    assert "embedding=" not in repr(result) and expected not in repr(result)
    client.responses.create.assert_not_called()


def test_frame_query_share_model_dimensions_and_preserve_query(client):
    service = EmbeddingService(client=client)
    frame = service.embed_frame(caption="A classroom door.")
    query = service.embed_query("  ماذا كُتب على باب الغرفة؟  ")
    assert query.source_text == "ماذا كُتب على باب الغرفة؟"
    assert frame.model == query.model == DEFAULT_MODEL
    assert frame.dimensions == query.dimensions == 1536
    assert client.embeddings.create.call_count == 2
    assert client.embeddings.create.call_args.kwargs["input"] == query.source_text


@pytest.mark.parametrize("bad, exception", [(None, TypeError), (123, TypeError), ("", ValueError), (" \n", ValueError)])
def test_invalid_queries_never_call_api(client, bad, exception):
    with pytest.raises(exception):
        EmbeddingService(client=client).embed_query(bad)
    client.embeddings.create.assert_not_called()


def test_byte_limit_not_character_or_token_count(client):
    assert validate_text("a" * MAX_INPUT_BYTES) == "a" * MAX_INPUT_BYTES
    # Arabic occupies multiple UTF-8 bytes per character.
    assert len(("غ" * 4096).encode("utf-8")) == MAX_INPUT_BYTES
    assert validate_text("غ" * 4096) == "غ" * 4096
    for text in ("a" * (MAX_INPUT_BYTES + 1), "غ" * 4097):
        with pytest.raises(ValueError, match="not truncated"):
            EmbeddingService(client=client).embed_query(text)
    client.embeddings.create.assert_not_called()


def test_invalid_unicode_is_controlled(client):
    with pytest.raises(ValueError, match="Unicode"):
        EmbeddingService(client=client).embed_query("\ud800")
    client.embeddings.create.assert_not_called()


@pytest.mark.parametrize("vector", [
    [], [1.0] * 1535, [1.0] * 1537, [0.0] * 1536,
    [float("nan")] * 1536, [float("inf")] * 1536,
    [True] * 1536, ["1"] * 1536, [None] * 1536,
])
def test_invalid_response_vectors(client, vector):
    response = sdk_response()
    # Assign after construction: the SDK constructor coerces Boolean lists
    # into floats, which would hide this deliberately malformed test input.
    response.data[0].embedding = vector
    client.embeddings.create.return_value = response
    with pytest.raises(EmbeddingResponseError, match="1536"):
        EmbeddingService(client=client).embed_query("door")


def test_empty_missing_malformed_and_wrong_model_responses(client):
    responses = [None, {}, sdk_response(model="another-model")]
    empty = sdk_response()
    empty.data = []
    responses.append(empty)
    missing = sdk_response()
    missing.data[0] = Embedding.model_construct(index=0, object="embedding")
    responses.append(missing)
    wrong_index = sdk_response()
    wrong_index.data[0].index = 1
    responses.append(wrong_index)
    for response in responses:
        client.embeddings.create.return_value = response
        with pytest.raises(EmbeddingResponseError):
            EmbeddingService(client=client).embed_query("door")


def test_missing_key_lazy_creation_and_owned_cleanup(client, monkeypatch):
    with patch("processing.embedding_service.OpenAI") as factory:
        service = EmbeddingService()
        factory.assert_not_called()
        with pytest.raises(EmbeddingConfigurationError, match="OPENAI_API_KEY"):
            service.embed_query("door")
        factory.assert_not_called()
        monkeypatch.setenv("OPENAI_API_KEY", "offline-placeholder")
        factory.return_value.__enter__.return_value = client
        EmbeddingService().embed_query("door")
        factory.assert_called_once_with(api_key="offline-placeholder", timeout=30.0, max_retries=0)
        factory.return_value.__exit__.assert_called_once()


def test_model_and_dimension_configuration(tmp_path, monkeypatch, client):
    env = tmp_path / "settings.env"
    env.write_text("OPENAI_API_KEY=offline-key\nOPENAI_EMBEDDING_MODEL=file-model\n"
                   "OPENAI_EMBEDDING_DIMENSIONS=1536\n", encoding="utf-8")
    monkeypatch.setattr(embedding_service, "ENV_FILE", env)
    assert EmbeddingService(client=client).model == "file-model"
    monkeypatch.setenv("OPENAI_EMBEDDING_MODEL", "environment-model")
    client.embeddings.create.return_value = sdk_response(model="environment-model")
    service = EmbeddingService(client=client)
    assert service.embed_query("door").model == "environment-model"
    assert EmbeddingService(client=client, model="explicit-model").model == "explicit-model"
    monkeypatch.setenv("OPENAI_EMBEDDING_DIMENSIONS", "512")
    with pytest.raises(EmbeddingConfigurationError, match="1536"):
        EmbeddingService(client=client)


@pytest.mark.parametrize("dimensions", [0, 512, 1536.0, True, "1536.0", "", "3072"])
def test_incompatible_dimensions_rejected(dimensions):
    with pytest.raises(EmbeddingConfigurationError, match="1536"):
        EmbeddingService(dimensions=dimensions)


@pytest.mark.parametrize("model", ["", " ", 123])
def test_invalid_model(model):
    with pytest.raises(EmbeddingConfigurationError):
        EmbeddingService(model=model)


@pytest.mark.parametrize("timeout", [0, -1, 301, float("nan"), float("inf"), True, "30"])
def test_invalid_timeout(timeout):
    with pytest.raises(EmbeddingConfigurationError):
        EmbeddingService(timeout_seconds=timeout)


@pytest.mark.parametrize("status, sdk_error, expected", [
    (401, openai.AuthenticationError, EmbeddingAuthenticationError),
    (403, openai.PermissionDeniedError, EmbeddingAuthenticationError),
    (429, openai.RateLimitError, EmbeddingRateLimitError),
    (400, openai.BadRequestError, EmbeddingServiceError),
    (503, openai.InternalServerError, EmbeddingServiceError),
])
def test_api_errors_are_sanitized_and_not_retried(client, status, sdk_error, expected):
    response = httpx.Response(status, request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))
    client.embeddings.create.side_effect = sdk_error("private-key-value", response=response,
                                                    body={"message": "private-key-value"})
    with pytest.raises(expected) as caught:
        EmbeddingService(client=client).embed_query("door")
    assert "private-key-value" not in "".join(traceback.format_exception(caught.type, caught.value, caught.tb))
    client.embeddings.create.assert_called_once()


def test_quota_error_is_distinguished(client):
    response = httpx.Response(429, request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))
    client.embeddings.create.side_effect = openai.RateLimitError("private", response=response,
                                                               body={"code": "insufficient_quota"})
    with pytest.raises(EmbeddingRateLimitError, match="credits or usage/spend quota"):
        EmbeddingService(client=client).embed_query("door")


@pytest.mark.parametrize("timeout, expected", [(False, EmbeddingNetworkError), (True, EmbeddingTimeoutError)])
def test_network_and_timeout_errors(client, timeout, expected):
    request = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    client.embeddings.create.side_effect = (openai.APITimeoutError(request=request) if timeout
                                           else openai.APIConnectionError(request=request))
    with pytest.raises(expected):
        EmbeddingService(client=client).embed_query("door")
    client.embeddings.create.assert_called_once()


@pytest.mark.parametrize("first, second, expected", [
    ([1, 2, 3], [1, 2, 3], 1), ([1, 0], [0, 1], 0), ([1, 2], [-1, -2], -1),
    ([1e308, -1e308], [1e308, -1e308], 1), ([1e-308, 0], [1, 0], 1),
])
def test_cosine_known_vectors_and_numeric_stability(first, second, expected):
    original = first.copy(), second.copy()
    assert cosine_similarity(first, second) == pytest.approx(expected)
    assert (first, second) == original


@pytest.mark.parametrize("first, second, exception", [
    ([1, 0], [1], ValueError), ([0, 0], [1, 0], ValueError),
    ([], [], ValueError), ([[1, 2]], [1, 2], ValueError),
    ([np.nan], [1], ValueError), ([np.inf], [1], ValueError),
    (["1"], [1], TypeError), ([True], [1], TypeError),
    ([1 + 2j], [1], TypeError), (None, [1], TypeError),
])
def test_invalid_cosine_inputs(first, second, exception):
    with pytest.raises(exception):
        cosine_similarity(first, second)


def test_numpy_vectors_preserved():
    first, second = np.array([1., 2., 3.]), np.array([2., 3., 4.])
    before = first.copy(), second.copy()
    assert np.isfinite(cosine_similarity(first, second))
    np.testing.assert_array_equal(first, before[0])
    np.testing.assert_array_equal(second, before[1])


def test_existing_ocr_and_vision_results_are_accepted_unchanged(client):
    from processing.ocr_service import OCRResult
    from processing.object_detector import VisionResult
    ocr = OCRResult("الغرفة ٢٠٥", "mistral-ocr-latest", True, "الغرفة ٢٠٥")
    vision = VisionResult(["Door", "sign", "door"], "A door in a corridor.", "gpt-5.4-mini", False)
    originals = asdict(ocr), asdict(vision)
    result = EmbeddingService(client=client).embed_frame(ocr.text, vision.objects, vision.caption)
    assert result.source_text == "Scene: A door in a corridor.\nObjects: door, sign\nVisible text: الغرفة ٢٠٥"
    assert (asdict(ocr), asdict(vision)) == originals
    client.responses.create.assert_not_called()


def test_real_sdk_offline_serialization_and_response_validation():
    attempts = []

    def handle(request):
        attempts.append(request)
        payload = json.loads(request.content)
        assert request.url.path == "/v1/embeddings"
        assert payload == {"model": DEFAULT_MODEL, "input": "door", "dimensions": 1536, "encoding_format": "float"}
        assert all(value == 30 for value in request.extensions["timeout"].values())
        return httpx.Response(200, json=sdk_response().model_dump(mode="json"))

    with httpx.Client(transport=httpx.MockTransport(handle)) as transport:
        with OpenAI(api_key="offline-placeholder", http_client=transport) as sdk:
            result = EmbeddingService(client=sdk).embed_query("door")
    assert len(attempts) == 1 and len(result.embedding) == 1536


def test_real_sdk_429_no_retry():
    attempts = []

    def handle(request):
        attempts.append(request)
        return httpx.Response(429, json={"error": {"message": "private", "code": "insufficient_quota"}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as transport:
        with OpenAI(api_key="offline-placeholder", http_client=transport) as sdk:
            with pytest.raises(EmbeddingRateLimitError):
                EmbeddingService(client=sdk).embed_query("door")
    assert len(attempts) == 1


@pytest.mark.parametrize("arguments, label", [
    (["--caption", "A door.", "--objects", "door,sign", "--ocr-text", "ROOM 205"], "Embedding generated successfully"),
    (["--query", "What was written on the door?"], "Query embedding generated successfully"),
])
def test_cli_mocked_output(client, monkeypatch, capsys, arguments, label):
    monkeypatch.setenv("OPENAI_API_KEY", "offline-placeholder")
    with patch("processing.embedding_service.OpenAI") as factory:
        factory.return_value.__enter__.return_value = client
        assert main(arguments) == 0
    output = capsys.readouterr().out
    assert label in output and "1536" in output and DEFAULT_MODEL in output
    assert "offline-placeholder" not in output and len(output) < 800
    client.embeddings.create.assert_called_once()


def test_cli_skip_invalid_query_mixed_options_and_missing_key(capsys):
    assert main([]) == 0
    assert "Skipped" in capsys.readouterr().out
    assert main(["--query", ""]) == 1
    assert "must not be empty" in capsys.readouterr().err
    assert main(["--query", "door", "--caption", "A door."]) == 1
    assert "not both" in capsys.readouterr().err
    assert main(["--query", "door"]) == 1
    assert "OPENAI_API_KEY" in capsys.readouterr().err


def test_import_and_initialization_make_no_api_requests(client):
    with patch("processing.embedding_service.OpenAI") as factory:
        EmbeddingService(client=client)
        factory.assert_not_called()
        client.embeddings.create.assert_not_called()
    code = ("from unittest.mock import patch, Mock\n"
            "with patch('httpx.Client.send', side_effect=AssertionError('Unexpected network')):\n"
            "    import processing.embedding_service as module\n"
            "    module.EmbeddingService(client=Mock())\n")
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_private_env_ignored_and_template_has_no_credentials():
    root = Path(__file__).resolve().parents[2]
    command = ["git", "-c", f"safe.directory={root.as_posix()}"]
    ignored = subprocess.run([*command, "check-ignore", "multimedia/api/.env"], cwd=root,
                             capture_output=True, text=True)
    tracked = subprocess.run([*command, "ls-files", "--", "multimedia/api/.env"], cwd=root,
                             capture_output=True, text=True)
    assert ignored.returncode == 0 and tracked.returncode == 0 and not tracked.stdout.strip()
    config = dotenv_values(root / "multimedia" / "api" / ".env.example")
    if config.get("OPENAI_API_KEY") or config.get("MISTRAL_API_KEY"):
        pytest.fail("Keep credentials out of .env.example; use only the ignored private .env.")


def test_similarity_demo_makes_three_explicit_requests(client, capsys):
    from scripts import demo_embedding_similarity
    door = [1.0] + [0.0] * 1535
    laptop = [0.0, 1.0] + [0.0] * 1534
    query = [0.7, 0.3] + [0.0] * 1534
    client.embeddings.create.side_effect = [sdk_response(vector) for vector in (door, laptop, query)]
    with patch.object(demo_embedding_similarity, "EmbeddingService", return_value=EmbeddingService(client=client)):
        assert demo_embedding_similarity.main() == 0
    assert client.embeddings.create.call_count == 3
    output = capsys.readouterr().out
    assert "Frame vectors differ: True" in output
    assert "Query / door cosine:" in output and "Query / laptop cosine:" in output
    assert "ranking is not guaranteed" in output
