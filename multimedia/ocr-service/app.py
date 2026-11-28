"""Private, bounded, memory-only OCR. No generative completion of detected text."""
import asyncio
import io
import os
import threading
from contextlib import asynccontextmanager
import numpy as np
from PIL import Image
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

models = {}
failed = False
lock = threading.Lock()
THRESHOLD = float(os.getenv('OCR_MIN_CONFIDENCE', '0.85'))
if not 0 <= THRESHOLD <= 1:
    raise ValueError('OCR_MIN_CONFIDENCE must be between zero and one')

def load():
    global failed
    try:
        from paddleocr import PaddleOCR
        # Explicit v5 names preserve Arabic support rather than relying on the v6 default.
        for lang, name in [('en','en'), ('fr','latin'), ('ar','arabic')]:
            models[lang] = PaddleOCR(ocr_version='PP-OCRv5',
                text_detection_model_name='PP-OCRv5_mobile_det',
                text_recognition_model_name=name+'_PP-OCRv5_mobile_rec',
                use_doc_orientation_classify=False, use_doc_unwarping=False,
                use_textline_orientation=False, device=os.getenv('OCR_DEVICE','cpu'),
                cpu_threads=4, enable_mkldnn=False)
    except Exception as error:
        failed = True
        print('OCR initialization failed: '+type(error).__name__, flush=True)

@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=load, daemon=True).start()
    yield

app = FastAPI(lifespan=lifespan)

def error(code, message, status):
    return JSONResponse({'error':{'code':code,'message':message}}, status_code=status)

@app.get('/health')
def health():
    ready = len(models)==3 and not failed
    return JSONResponse({'ready':ready,'failed':failed,'languages':list(models)},status_code=200 if ready else 503)

def recognize(data, lang):
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 16000000:
            raise ValueError('Image too large')
        image = image.convert('RGB'); image.thumbnail((1600,1600))
        bgr = np.asarray(image)[:,:,::-1].copy()
    lines=[]; scores=[]
    for result in models[lang].predict(bgr, text_rec_score_thresh=0.0):
        lines.extend(result['rec_texts']); scores.extend(float(v) for v in result['rec_scores'])
    pairs=[(t.strip(),s) for t,s in zip(lines,scores) if t.strip()]
    unclear=any(s<THRESHOLD for _,s in pairs)
    status='unclear' if unclear else 'ok' if pairs else 'no_text'
    # Do not return partial guessed lines when any detected line is uncertain.
    text='\n'.join(t for t,_ in pairs) if status=='ok' else ''
    return {'text':text,'raw_markdown':text,'has_text':bool(text),
            'model':'paddleocr-PP-OCRv5','status':status,
            'confidence':min((s for _,s in pairs),default=0.0)}

@app.post('/api/v1/ocr')
async def ocr(request: Request):
    lang=request.query_params.get('lang','en')
    if lang not in ('ar','en','fr'): return error('invalid_language','Use ar, en or fr.',422)
    data=bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>4*1024*1024: return error('image_too_large','Maximum image size is 4 MiB.',413)
        data.extend(chunk)
    if len(models)!=3 or failed: return error('ocr_unavailable','OCR models are loading or unavailable.',503)
    if not lock.acquire(False): return error('ocr_busy','OCR is busy. Try again.',429)
    try:
        result=await asyncio.to_thread(recognize,bytes(data),lang)
        return JSONResponse(result,headers={'Cache-Control':'no-store'})
    except (ValueError, OSError): return error('invalid_image','Send a valid small image.',422)
    except Exception: return error('ocr_failed','Text could not be read.',503)
    finally: lock.release()
