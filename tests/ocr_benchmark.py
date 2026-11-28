"""Real OCR CER/latency; writes JSON to stdout, never uploads user images."""
import json
import os
import time
import unicodedata
from pathlib import Path
import urllib.request

def distance(a,b):
    row=list(range(len(b)+1))
    for i,c in enumerate(a):
        new=[i+1]
        for j,d in enumerate(b): new.append(min(new[-1]+1,row[j+1]+1,row[j]+(c!=d)))
        row=new
    return row[-1]

if __name__=='__main__':
    root=Path(__file__).parent/'fixtures/ocr'
    cases=json.loads((root/'cases.json').read_text(encoding='utf-8'))['cases']
    results=[]
    for case in cases:
        start=time.perf_counter()
        req=urllib.request.Request(os.getenv('OCR_TEST_URL','http://127.0.0.1:8004')+'/api/v1/ocr?lang='+case['lang'],
            data=(root/case['file']).read_bytes(),headers={'Content-Type':'image/png'})
        with urllib.request.urlopen(req,timeout=180) as response: result=json.load(response)
        a=unicodedata.normalize('NFC',case['text']); b=unicodedata.normalize('NFC',result['text'])
        results.append({**case,**result,'expected_text':case['text'],'latency_ms':round((time.perf_counter()-start)*1000),'cer':distance(a,b)/max(1,len(a))})
    print(json.dumps(results,ensure_ascii=False,indent=2))
    assert results[-1]['status']=='no_text' and not results[-1]['text']
