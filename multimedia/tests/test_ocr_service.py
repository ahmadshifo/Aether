import httpx
import numpy as np
import pytest
from processing.ocr_service import OCRService, OCRResult, OCRServiceError, OCRResponseError, OCRRateLimitError, OCRTimeoutError, parse_response

@pytest.mark.parametrize("lang",["en","fr","ar"])
@pytest.mark.parametrize("state,text,score",[("ok","ROOM 205",.99),("unclear","",.2),("no_text","",0)])
def test_local_contract(lang,state,text,score):
    def respond(request):
        assert request.url.params["lang"]==lang
        assert request.content[:2]==b"\xff\xd8"
        return httpx.Response(200,json={"text":text,"model":"paddleocr-PP-OCRv5","status":state,"confidence":score})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result=OCRService(client=client).extract_text(np.zeros((20,20,3),dtype=np.uint8),lang)
        assert result.text==text and result.has_text==bool(text)
        assert result.status==state and result.raw_markdown==text

@pytest.mark.parametrize("bad",[{}, {"status":"bad","text":"guess","confidence":1}, {"status":"ok","text":"x","confidence":2}])
def test_bad_response(bad):
    with pytest.raises(OCRResponseError): parse_response(bad)

@pytest.mark.parametrize("code",[429,503,401])
def test_failure_is_not_no_text(code):
    with httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(code))) as client:
        with pytest.raises(OCRServiceError): OCRService(client=client).extract_text(np.zeros((20,20,3),dtype=np.uint8))

def test_uncertain_response_never_exposes_candidate_text():
    result=parse_response({"text":"guess","status":"unclear","confidence":.3,"model":"local"})
    assert result.text==result.raw_markdown=="" and not result.has_text
