"""Explicit text embeddings for frame metadata and natural-language queries."""

import argparse
import math
import os
import sys
from dataclasses import dataclass, field
from numbers import Integral, Real
from pathlib import Path

import numpy as np
import openai
from dotenv import dotenv_values
from openai import OpenAI
from openai.types import CreateEmbeddingResponse

from .object_detector import normalize_objects

DEFAULT_MODEL = "text-embedding-3-small"
EXPECTED_DIMENSIONS = 1536
# A conservative local byte bound, NOT a token count. No tokenizer download
# is needed; some inputs within the provider's token budget may be rejected.
MAX_INPUT_BYTES = 8192
ENV_FILE = Path(__file__).resolve().parents[1] / "api" / ".env"


class EmbeddingServiceError(RuntimeError):
    pass


class EmbeddingConfigurationError(EmbeddingServiceError):
    pass


class EmbeddingAuthenticationError(EmbeddingServiceError):
    pass


class EmbeddingNetworkError(EmbeddingServiceError):
    pass


class EmbeddingTimeoutError(EmbeddingServiceError):
    pass


class EmbeddingRateLimitError(EmbeddingServiceError):
    pass


class EmbeddingResponseError(EmbeddingServiceError):
    pass


@dataclass(frozen=True)
class EmbeddingResult:
    model: str
    dimensions: int
    source_text: str = field(repr=False)
    embedding: list[float] = field(repr=False)


def _optional_text(value: str | None, name: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string or None.")
    return value.strip()


def build_frame_description(ocr_text: str | None = None,
                            objects: list[str] | None = None,
                            caption: str | None = None) -> str:
    """Combine only supplied semantic text in Scene/Objects/Visible text order.

    No punctuation is added to existing captions or OCR text. Object labels
    reuse Task 8 normalization. Empty/missing sections are omitted entirely.
    """
    ocr_text = _optional_text(ocr_text, "ocr_text")
    caption = _optional_text(caption, "caption")
    labels = normalize_objects(objects if objects is not None else [])
    sections = []
    if caption:
        sections.append(f"Scene: {caption}")
    if labels:
        sections.append(f"Objects: {', '.join(labels)}")
    if ocr_text:
        sections.append(f"Visible text: {ocr_text}")
    return "\n".join(sections)


def validate_text(text: str) -> str:
    if not isinstance(text, str):
        raise TypeError("Embedding input must be a text string.")
    text = text.strip()
    if not text:
        raise ValueError("Embedding input must not be empty.")
    try:
        byte_count = len(text.encode("utf-8"))
    except UnicodeEncodeError:
        raise ValueError("Embedding input must contain valid Unicode text.") from None
    if byte_count > MAX_INPUT_BYTES:
        raise ValueError(f"Embedding input exceeds the conservative {MAX_INPUT_BYTES}-byte UTF-8 limit; text was not truncated.")
    return text


def _numeric_vector(vector) -> np.ndarray:
    if not isinstance(vector, (list, tuple, np.ndarray)):
        raise TypeError("Vector must be a list, tuple, or one-dimensional NumPy array.")
    array = np.asarray(vector)
    if array.ndim != 1 or array.size == 0:
        raise ValueError("Vector must be nonempty and one-dimensional.")
    if any(isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) for value in vector):
        raise TypeError("Vector values must be real numbers, excluding booleans.")
    try:
        array = np.asarray(vector, dtype=np.float64)
    except (TypeError, ValueError, OverflowError):
        raise ValueError("Vector values must be finite numbers.") from None
    if not np.isfinite(array).all():
        raise ValueError("Vector values must be finite numbers.")
    if not np.any(array):
        raise ValueError("Vector must have nonzero magnitude.")
    return array


def cosine_similarity(vector1, vector2) -> float:
    """Finite cosine in [-1, 1]; this is similarity, not a probability.

    Scale before taking norms to avoid overflow/underflow on finite inputs.
    The input vectors are neither resized nor modified.
    """
    first, second = _numeric_vector(vector1), _numeric_vector(vector2)
    if first.size != second.size:
        raise ValueError("Vectors must have equal lengths.")
    first = first / np.max(np.abs(first))
    second = second / np.max(np.abs(second))
    first = first / np.linalg.norm(first)
    second = second / np.linalg.norm(second)
    return float(np.clip(np.dot(first, second), -1.0, 1.0))


def parse_embedding_response(response: CreateEmbeddingResponse, model: str, source_text: str) -> EmbeddingResult:
    try:
        if not isinstance(response, CreateEmbeddingResponse):
            raise ValueError("Expected SDK embedding response")
        if response.model != model:
            raise ValueError("Response model mismatch")
        if len(response.data) != 1 or type(response.data[0].index) is not int or response.data[0].index != 0:
            raise ValueError("Expected one embedding for input zero")
        vector = _numeric_vector(response.data[0].embedding)
        if vector.size != EXPECTED_DIMENSIONS:
            raise ValueError("Wrong embedding dimensions")
    except Exception:
        raise EmbeddingResponseError(
            "Invalid embedding response: expected one finite, nonzero 1536-value vector from the configured model."
        ) from None
    return EmbeddingResult(model, EXPECTED_DIMENSIONS, source_text, vector.tolist())


class EmbeddingService:
    """One request per explicit embedding operation; no OCR, vision, or storage.

    Both frame and query embeddings use this instance's model and the fixed
    1536 dimensions. Import/construction does not contact OpenAI. None from
    embed_frame means skipped empty metadata, never a fabricated zero vector.
    """

    def __init__(self, client=None, model: str | None = None,
                 dimensions: int | None = None, timeout_seconds: float = 30.0):
        try:
            settings = dotenv_values(ENV_FILE, interpolate=False)
        except Exception:
            raise EmbeddingConfigurationError("Could not read embedding configuration from api/.env.") from None
        configured = os.environ.get("OPENAI_EMBEDDING_MODEL", settings.get("OPENAI_EMBEDDING_MODEL", DEFAULT_MODEL))
        self.model = model if model is not None else configured
        if not isinstance(self.model, str) or not self.model.strip():
            raise EmbeddingConfigurationError("OPENAI_EMBEDDING_MODEL must be a nonempty model identifier.")
        self.model = self.model.strip()
        if dimensions is None:
            dimensions = os.environ.get("OPENAI_EMBEDDING_DIMENSIONS", settings.get("OPENAI_EMBEDDING_DIMENSIONS", "1536"))
        if isinstance(dimensions, str):
            dimensions = dimensions.strip()
            if dimensions != "1536":
                raise EmbeddingConfigurationError("OPENAI_EMBEDDING_DIMENSIONS must be 1536 for this project.")
            dimensions = int(dimensions)
        if isinstance(dimensions, bool) or not isinstance(dimensions, Integral) or dimensions != EXPECTED_DIMENSIONS:
            raise EmbeddingConfigurationError("OPENAI_EMBEDDING_DIMENSIONS must be 1536 for this project.")
        self.dimensions = EXPECTED_DIMENSIONS
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, Real):
            raise EmbeddingConfigurationError("timeout_seconds must be a number between 0.001 and 300.")
        try:
            self.timeout_seconds = float(timeout_seconds)
        except OverflowError:
            raise EmbeddingConfigurationError("timeout_seconds must be finite.") from None
        if not math.isfinite(self.timeout_seconds) or not 0.001 <= self.timeout_seconds <= 300:
            raise EmbeddingConfigurationError("timeout_seconds must be between 0.001 and 300.")
        self._api_key = os.environ.get("OPENAI_API_KEY", settings.get("OPENAI_API_KEY"))
        self._client = client

    def embed_frame(self, ocr_text: str | None = None, objects: list[str] | None = None,
                    caption: str | None = None) -> EmbeddingResult | None:
        description = build_frame_description(ocr_text, objects, caption)
        if not description:
            return None
        return self._embed_text(description)

    def embed_query(self, query: str) -> EmbeddingResult:
        return self._embed_text(query)

    def _embed_text(self, text: str) -> EmbeddingResult:
        text = validate_text(text)
        if self._client is None and (not self._api_key or not self._api_key.strip()):
            raise EmbeddingConfigurationError("OPENAI_API_KEY is missing; configure the environment or api/.env.")
        try:
            if self._client is not None:
                response = self._request(self._client, text)
            else:
                with OpenAI(api_key=self._api_key.strip(), timeout=self.timeout_seconds, max_retries=0) as client:
                    response = self._request(client, text)
        except openai.APITimeoutError:
            raise EmbeddingTimeoutError("OpenAI embedding request timed out; no retry was attempted.") from None
        except openai.APIConnectionError:
            raise EmbeddingNetworkError("Cannot connect to OpenAI embeddings; check the network connection.") from None
        except (openai.AuthenticationError, openai.PermissionDeniedError):
            raise EmbeddingAuthenticationError("OpenAI authentication/access failed; check the key and permissions.") from None
        except openai.RateLimitError as error:
            if error.code in ("insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
                              "project_spend_limit_exceeded", "organization_usage_limit_exceeded"):
                raise EmbeddingRateLimitError("OpenAI API credits or usage/spend quota are exhausted; check billing and limits.") from None
            raise EmbeddingRateLimitError("OpenAI embedding rate limit or quota reached; no retry was attempted.") from None
        except openai.APIResponseValidationError:
            raise EmbeddingResponseError("OpenAI returned an invalid embedding response.") from None
        except openai.APIStatusError as error:
            raise EmbeddingServiceError(f"OpenAI embedding request failed (HTTP {error.status_code}); check input, model, or service availability.") from None
        except Exception:
            raise EmbeddingServiceError("OpenAI embedding request failed; provider details were suppressed.") from None
        return parse_embedding_response(response, self.model, text)

    def _request(self, client, text: str) -> CreateEmbeddingResponse:
        return client.with_options(max_retries=0).embeddings.create(
            model=self.model, input=text, dimensions=self.dimensions,
            encoding_format="float", timeout=self.timeout_seconds,
        )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caption")
    parser.add_argument("--objects", help="Comma-separated object labels")
    parser.add_argument("--ocr-text")
    parser.add_argument("--query", help="Embed a query instead of frame metadata")
    args = parser.parse_args(argv)
    try:
        if args.query is not None and any(value is not None for value in (args.caption, args.objects, args.ocr_text)):
            raise ValueError("Use --query alone or frame metadata options, not both.")
        service = EmbeddingService()
        if args.query is not None:
            result = service.embed_query(args.query)
        else:
            result = service.embed_frame(args.ocr_text, args.objects.split(",") if args.objects is not None else None, args.caption)
        if result is None:
            print("Skipped: no usable frame metadata; no embedding request was made.")
            return 0
        print("Aether - Semantic Embedding Analysis\n")
        print(f"{'Query' if args.query is not None else 'Combined description'}:\n{result.source_text}\n")
        print(f"Model: {result.model}\nVector dimensions: {result.dimensions}")
        preview = ", ".join(f"{value:.6g}" for value in result.embedding[:5])
        print(f"Embedding preview: [{preview}, ...]")
        print("Query embedding generated successfully." if args.query is not None else "Embedding generated successfully.")
        return 0
    except (TypeError, ValueError, EmbeddingServiceError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
