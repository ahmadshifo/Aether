"""Explicit local OCR requests; images and responses remain in memory."""
import os
from dataclasses import dataclass
import httpx
from .image_utils import ImageEncodingError, encode_jpeg, image_to_data_url

class OCRServiceError(RuntimeError): pass
class OCRConfigurationError(OCRServiceError): pass
class OCRAuthenticationError(OCRServiceError): pass
class OCRNetworkError(OCRServiceError): pass
class OCRTimeoutError(OCRServiceError): pass
class OCRRateLimitError(OCRServiceError): pass
class OCRResponseError(OCRServiceError): pass

@dataclass(frozen=True)
class OCRResult:
    text: str
    model: str
    has_text: bool
    raw_markdown: str
    status: str = 'ok'
    confidence: float = 1.0

def parse_response(body):
    try:
        if body['status'] not in ('ok','unclear','no_text') or not isinstance(body['text'],str): raise ValueError()
        score=float(body['confidence'])
        if not 0<=score<=1: raise ValueError()
        text=body['text'] if body['status']=='ok' else ''
        return OCRResult(text,body['model'],bool(text),text,body['status'],score)
    except (KeyError,ValueError,TypeError): raise OCRResponseError('Invalid local OCR response.') from None

class OCRService:
    def __init__(self, client=None, model=None, timeout_seconds=30):
        if isinstance(timeout_seconds,bool) or not 0<float(timeout_seconds)<=300: raise OCRConfigurationError('Invalid timeout.')
        self._client=client
        self.timeout=timeout_seconds
        self.model=model or 'paddleocr-PP-OCRv5'
        self.origin=os.getenv('OCR_SERVICE_URL','http://127.0.0.1:8004').rstrip('/')
    def extract_text(self,image,language=None):
        jpeg=encode_jpeg(image)
        lang=language or os.getenv('OCR_DEFAULT_LANGUAGE','en')
        try:
            if self._client is not None:
                response=self._client.post(self.origin+'/api/v1/ocr',params={'lang':lang},content=jpeg,headers={'Content-Type':'image/jpeg'},timeout=self.timeout)
            else:
                with httpx.Client(trust_env=False) as client:
                    response=client.post(self.origin+'/api/v1/ocr',params={'lang':lang},content=jpeg,headers={'Content-Type':'image/jpeg'},timeout=self.timeout)
            if response.status_code==429: raise OCRRateLimitError('Local OCR is busy.')
            if response.status_code!=200: raise OCRServiceError('Local OCR is unavailable.')
            return parse_response(response.json())
        except httpx.TimeoutException: raise OCRTimeoutError('Local OCR timed out.') from None
        except httpx.RequestError: raise OCRNetworkError('Local OCR cannot be reached.') from None
