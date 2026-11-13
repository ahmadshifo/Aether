import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceApi, voiceOrigin } from '../src/voice/apiClient.ts';
import { UtteranceGate } from '../src/voice/utterance.ts';
const signal = () => new AbortController().signal;
test('voice address follows the current Wi-Fi and rejects a different cookie host', () => {
  assert.equal(voiceOrigin({ backend: 'http://192.168.5.2:8002', media: '', allowLan: true }), 'http://192.168.5.2:8001');
  assert.equal(voiceOrigin({ backend: 'https://aether.example', media: '', allowLan: false }), 'https://aether.example');
  assert.throws(() => voiceOrigin({ backend: 'https://aether.example', voice: 'https://other.example', media: '', allowLan: false }), /voice_host_mismatch/);
});
for (const language of ['en', 'ar', 'fr']) test(`multipart sends actual bytes and selected language: ${language}`, async () => {
  const bytes = new Uint8Array([0, 255, 128, 64, 1]);
  const api = createVoiceApi('https://aether.example', async (url, options) => {
    assert.equal(options.credentials, 'include'); assert.equal(options.headers['X-Aether-Voice'], '1');
    const body = await new Request(url, options).formData();
    assert.equal(body.get('language'), language);
    assert.deepEqual(new Uint8Array(await body.get('audio').arrayBuffer()), bytes);
    return Response.json({ text: 'أين الباب؟ Où est la porte ?', language });
  });
  assert.equal(await api.transcribe(bytes, language, signal()), 'أين الباب؟ Où est la porte ?');
});
test('TTS preserves text and returns binary MP3 bytes', async () => {
  const api = createVoiceApi('https://aether.example', async (_, options) => {
    assert.deepEqual(JSON.parse(options.body), { text: 'الباب أمامك.', language: 'ar' });
    return new Response(new Uint8Array([73, 68, 51, 0, 255]), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  assert.deepEqual(await api.synthesize('الباب أمامك.', 'ar', signal()), new Uint8Array([73, 68, 51, 0, 255]));
});
test('quota failures make one call and do not fall back', async () => {
  let calls = 0;
  const api = createVoiceApi('https://aether.example', async () => { calls++; return Response.json({}, { status: 429 }); });
  await assert.rejects(api.synthesize('Hello world', 'en', signal()), /voice_quota/); assert.equal(calls, 1);
});
test('authentication loss locks the owner; missing configuration is explicit', async () => {
  let locked = false;
  const api = createVoiceApi('https://aether.example', async () => Response.json({}, { status: 401 }), () => { locked = true; });
  await assert.rejects(api.synthesize('Hello world', 'en', signal()), /auth_lost/); assert.equal(locked, true);
  const unavailable = createVoiceApi('https://aether.example', async () => Response.json({ service: 'aether-voice', audio_ready: true, configured: false }));
  await assert.rejects(unavailable.check(signal()), /voice_unconfigured/);
});
test('cancelled synthesis cannot return late audio', async () => {
  const request = new AbortController();
  const api = createVoiceApi('https://aether.example', async () => { request.abort(); return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } }); });
  await assert.rejects(api.synthesize('Hello world', 'en', request.signal), /cancelled/);
});
test('silence stays local; a sentence ends after a pause; missing metering fails honestly', () => {
  const silent = new UtteranceGate(); assert.equal(silent.sample(8000, -90), 'silence');
  const gate = new UtteranceGate();
  for (const ms of [100, 200, 300]) assert.equal(gate.sample(ms, -22), 'wait');
  assert.equal(gate.sample(1000, -70), 'wait'); assert.equal(gate.sample(1700, -70), 'send');
  assert.equal(new UtteranceGate().sample(2100), 'unavailable');
});
