"""Real in-memory multilingual TTS -> STT test; prints synthetic text and timings only."""
import json
import time
import urllib.request
import io
import wave
import os

origin = os.getenv("VOICE_TEST_URL", "http://127.0.0.1:8001")
samples = {"en": "Hello. Where is the door?", "fr": "Bonjour. Où est la porte ?", "ar": "مرحبا. أين هو الباب؟"}
for lang, text in samples.items():
    start = time.perf_counter()
    request = urllib.request.Request(origin + "/api/v1/voice/tts",
        data=json.dumps({"text": text, "lang": lang}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=180) as response:
        audio = response.read()
        assert response.headers.get_content_type() == "audio/wav"
    tts_ms = round((time.perf_counter() - start) * 1000)
    with wave.open(io.BytesIO(audio)) as wav:
        seconds = round(wav.getnframes() / wav.getframerate(), 2)
        assert 0 < seconds <= 20
    start = time.perf_counter()
    request = urllib.request.Request(origin + "/api/v1/voice/stt?lang=" + lang, data=audio, headers={"Content-Type": "audio/wav"})
    with urllib.request.urlopen(request, timeout=180) as response:
        result = json.load(response)
    assert result["lang"] == lang and result["text"].strip(), result
    print(json.dumps({"lang": lang, "tts_ms": tts_ms, "stt_ms": round((time.perf_counter() - start) * 1000),
        "audio_seconds": seconds, "source_text": text, "recognized_text": result["text"]}, ensure_ascii=False), flush=True)
    assert {"en": "door", "ar": "باب", "fr": "porte"}[lang] in result["text"].lower(), "Expected keyword missing; review the language quality."
