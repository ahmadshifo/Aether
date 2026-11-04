"""Explicit single-image Mistral OCR, with offline-injectable clients."""

import argparse
import math
import os
import sys
from dataclasses import dataclass
from numbers import Real
from pathlib import Path

import cv2
import httpx
import numpy as np
from dotenv import dotenv_values
from mistralai.client import Mistral, errors
from mistralai.client.models import OCRResponse

# Preserve Task 7's public helper imports while sharing them with Task 8.
from .image_utils import ImageEncodingError, encode_jpeg, image_to_data_url

DEFAULT_MODEL = "mistral-ocr-latest"
ENV_FILE = Path(__file__).resolve().parents[1] / "api" / ".env"


class OCRServiceError(RuntimeError):
    """An OCR operation failed; this is distinct from a successful empty result."""


class OCRConfigurationError(OCRServiceError):
    pass


class OCRAuthenticationError(OCRServiceError):
    pass


class OCRNetworkError(OCRServiceError):
    pass


class OCRTimeoutError(OCRServiceError):
    pass


class OCRRateLimitError(OCRServiceError):
    pass


class OCRResponseError(OCRServiceError):
    pass


@dataclass(frozen=True)
class OCRResult:
    text: str
    model: str
    has_text: bool
    raw_markdown: str


def parse_response(response: OCRResponse) -> OCRResult:
    """Read SDK page markdown in provider order, retaining Unicode/formatting.

    text trims only outer whitespace. Markdown is intentionally retained to
    avoid destroying numbers, signs, line breaks, or multilingual content.
    raw_markdown preserves all page markdown joined with a blank line.
    """
    try:
        if not isinstance(response, OCRResponse):
            raise ValueError("Not an SDK OCR response")
        # Revalidate even an injected or model_construct-created SDK object.
        validated = OCRResponse.model_validate(response.model_dump(warnings=False), strict=True)
        if not validated.model.strip():
            raise ValueError("Missing response model")
        raw_markdown = "\n\n".join(page.markdown for page in validated.pages)
    except Exception:
        raise OCRResponseError("Mistral returned an invalid OCR response.") from None
    text = raw_markdown.strip()
    return OCRResult(text, validated.model, bool(text), raw_markdown)


class OCRService:
    """One explicit extract_text call makes at most one OCR request.

    Importing/constructing this class makes no requests. Environment values
    override the single agreed api/.env file. An injected client needs no key
    and remains owned by its caller. Owned SDK clients close after each call.
    No automatic retries, uploads, folder scans, or video processing occur.
    """

    def __init__(self, client=None, model: str | None = None, timeout_seconds: float = 30.0):
        try:
            settings = dotenv_values(ENV_FILE, interpolate=False)
        except Exception:
            raise OCRConfigurationError("Could not read OCR configuration from api/.env.") from None
        configured_model = os.environ.get("MISTRAL_OCR_MODEL", settings.get("MISTRAL_OCR_MODEL", DEFAULT_MODEL))
        self.model = model if model is not None else configured_model
        if not isinstance(self.model, str) or not self.model.strip():
            raise OCRConfigurationError("MISTRAL_OCR_MODEL must be a nonempty model identifier.")
        self.model = self.model.strip()
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, Real):
            raise OCRConfigurationError("timeout_seconds must be a number between 0.001 and 300.")
        try:
            timeout_seconds = float(timeout_seconds)
        except OverflowError:
            raise OCRConfigurationError("timeout_seconds must be finite.") from None
        if not math.isfinite(timeout_seconds) or not 0.001 <= timeout_seconds <= 300:
            raise OCRConfigurationError("timeout_seconds must be between 0.001 and 300.")
        self.timeout_ms = math.ceil(timeout_seconds * 1000)
        self._client = client
        self._api_key = os.environ.get("MISTRAL_API_KEY", settings.get("MISTRAL_API_KEY"))

    def extract_text(self, image: np.ndarray) -> OCRResult:
        """Send one image only when explicitly called; never hide API failures."""
        data_url = image_to_data_url(image)
        if self._client is None and (not self._api_key or not self._api_key.strip()):
            raise OCRConfigurationError("MISTRAL_API_KEY is missing; configure the environment or api/.env.")
        try:
            if self._client is not None:
                response = self._request(self._client, data_url)
            else:
                with Mistral(api_key=self._api_key.strip(), timeout_ms=self.timeout_ms,
                             retry_config=None) as client:
                    response = self._request(client, data_url)
        except errors.ResponseValidationError:
            raise OCRResponseError("Mistral returned an invalid OCR response.") from None
        except httpx.TimeoutException:
            raise OCRTimeoutError("Mistral OCR request timed out; no retry was attempted.") from None
        except (httpx.RequestError, errors.NoResponseError):
            raise OCRNetworkError("Cannot connect to Mistral OCR; check the network connection.") from None
        except errors.SDKError as error:
            # Never include provider bodies, credentials, or authenticated requests.
            status = error.status_code
            if status in (401, 403):
                raise OCRAuthenticationError("Mistral authentication/access failed; check the key and permissions.") from None
            if status == 429:
                raise OCRRateLimitError("Mistral rate limit or quota reached; no retry was attempted.") from None
            if status == 402:
                raise OCRServiceError("Mistral billing or credits require attention.") from None
            raise OCRServiceError(f"Mistral OCR request failed (HTTP {status}); no retry was attempted.") from None
        except Exception:
            raise OCRServiceError("Mistral OCR request failed; provider details were suppressed.") from None
        return parse_response(response)

    def _request(self, client, data_url: str) -> OCRResponse:
        return client.ocr.process(
            model=self.model,
            document={"type": "image_url", "image_url": data_url},
            include_image_base64=False,
            timeout_ms=self.timeout_ms,
            retries=None,
        )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--model", help="Override MISTRAL_OCR_MODEL for this request")
    args = parser.parse_args(argv)
    try:
        path = Path(args.image)
        if not path.is_file():
            raise FileNotFoundError(f"Image file not found: {path}")
        image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if image is None:
            raise ValueError(f"Cannot read image: {path}")
        service = OCRService(model=args.model)
        print("Aether - OCR Analysis\n")
        print(f"Image: {path}")
        print(f"OCR Model: {service.model}")
        print("Image loaded successfully")
        result = service.extract_text(image)
        if result.has_text:
            print(f"\nRecognized text:\n{result.text}")
        else:
            print("\nNo text detected.")
        print("\nOCR completed successfully.")
        return 0
    except (OSError, TypeError, ValueError, OCRServiceError, cv2.error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
