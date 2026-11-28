"""Read the selected evidence verbatim; never let a language model fill gaps."""
import os
import re
import unicodedata
import httpx

def is_reading(question):
    # Summary topic labels use substring matching; tool routing needs whole words
    # so "list objects" and "what colour is the sign" still use visual reasoning.
    text=''.join(c for c in unicodedata.normalize('NFKD',question.casefold()) if not unicodedata.combining(c))
    if re.search(r'\b(read|transcribe|lis|lisez|lire|اقرا)\b',text): return True
    if re.search(r'\b(color|colour|couleur|لون)\b',text): return False
    return bool(re.search(r'\b(written|wording|words|letters|text|texte|ecrit|ecrite|inscription|lettres|mots|مكتوب|النص|الكلمات|الحروف)\b',text)
                or re.search(r'\bwhat\b.*\b(say|says|sign|label|menu)\b',text)
                or re.search(r'\bque\b.*\b(dit|indique)\b',text)
                or re.search(r'\b(شو|ماذا)\b.*\b(بتقول|تقول)\b',text))

COPY = {
 'en': ('The text is unclear. Please move the camera closer and hold it steady.', 'No text was detected. Point the camera at the text and move closer.'),
 'ar': ('النص غير واضح. قرّب الكاميرا وثبّتها من فضلك.', 'لم أجد نصاً. وجّه الكاميرا نحو النص وقرّبها.'),
 'fr': ('Le texte est illisible. Rapprochez la caméra et gardez-la stable.', 'Aucun texte détecté. Dirigez la caméra vers le texte et rapprochez-la.'),
}

def read(jpeg, language):
    try:
        with httpx.Client(timeout=30, trust_env=False) as client:
            response=client.post(os.getenv('OCR_SERVICE_URL','http://127.0.0.1:8004')+'/api/v1/ocr',
                params={'lang':language},content=jpeg,headers={'Content-Type':'image/jpeg'})
        response.raise_for_status()
        result=response.json()
        if not isinstance(result['text'],str): raise ValueError('Invalid OCR text')
        score=float(result['confidence'])
        if not 0<=score<=1: raise ValueError('Invalid OCR confidence')
        if result['status']=='ok' and result['text'].strip() and score>=float(os.getenv('OCR_MIN_CONFIDENCE','0.85')):
            return result['text'],False
        return COPY[language][1 if result['status']=='no_text' else 0],True
    except (httpx.HTTPError,ValueError,KeyError,TypeError):
        return {'en':'Text reading is unavailable. Please try again shortly.', 'ar':'قراءة النص غير متاحة الآن. حاول بعد قليل.', 'fr':'La lecture du texte est indisponible. Réessayez bientôt.'}[language],True
