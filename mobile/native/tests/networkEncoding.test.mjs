import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { boundedFetch } from '../src/platform/config.ts';
import { createTeamApi } from '../src/services/teamApi.ts';
import { createHistoryApi } from '../src/storage/serverHistory.ts';
import { mergeHistory } from '../src/storage/history.ts';

const require = createRequire(import.meta.url);
const { Response: PhoneResponse } = require('whatwg-fetch');
const FetchResponse = globalThis.Response;
function usePhoneResponse(t) {
  // Use the actual polyfill installed by React Native, not Node's UTF-8-safe Response.
  globalThis.Response = PhoneResponse;
  t.after(() => { globalThis.Response = FetchResponse; });
}

for (const [language, answer] of [
  ['ar', 'حفظتُ ما رأته الكاميرا، لكن لا يمكنني وصفه بعد.'],
  ['fr', 'La caméra est prête. Où est l’entrée ?'],
  ['en', 'Camera ready — ask a question. 📷'],
]) test(`phone response preserves ${language} answer text before display, speech and storage`, async t => {
  usePhoneResponse(t);
  const request = { session_id: crypto.randomUUID(), question_id: crypto.randomUUID(), question: 'Read this', language };
  const expected = { question_id: request.question_id, language, answer, uncertain: true, evidence_frame_ids: [] };
  const api = createTeamApi('https://team.test', async () => FetchResponse.json(expected));
  assert.deepEqual(await api.ask(request, new AbortController().signal), expected);
});

test('refresh replaces a corrupted cached Arabic answer with canonical server UTF-8', async t => {
  usePhoneResponse(t);
  const record = { question_id: crypto.randomUUID(), session_id: crypto.randomUUID(),
    asked_at: new Date().toISOString(), language: 'ar', question: 'ماذا يوجد أمامي؟',
    answer: 'حفظتُ ما رأته الكاميرا.', uncertain: true, evidence_frame_ids: [] };
  const api = createHistoryApi('https://team.test', async () => FetchResponse.json({ questions: [record], next_cursor: null, demo: false }));
  const page = await api.page(null, new AbortController().signal);
  const cached = { ...page.entries[0], answer: Buffer.from(record.answer, 'utf8').toString('latin1') };
  assert.notEqual(cached.answer, record.answer);
  const merged = mergeHistory(page.entries, [cached]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].answer, record.answer);
  assert.equal(merged[0].question, record.question);
});

test('UTF-8 handling covers JSON variants and text without altering binary bodies or empty responses', async t => {
  usePhoneResponse(t);
  for (const type of ['application/problem+json; charset=utf-8', 'Application/JSON', 'text/plain']) {
    const expected = 'مرحباً — Bonjour, été';
    const response = await boundedFetch('https://team.test', {}, 1000,
      async () => new FetchResponse(expected, { headers: { 'Content-Type': type } }));
    assert.equal(await response.text(), expected);
  }
  const bytes = new Uint8Array([0, 255, 216, 128, 1]);
  const binary = await boundedFetch('https://team.test', {}, 1000,
    async () => new FetchResponse(bytes, { headers: { 'Content-Type': 'image/jpeg' } }));
  assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), bytes);
  const empty = await boundedFetch('https://team.test', {}, 1000, async () => new FetchResponse(null, { status: 204 }));
  assert.equal(empty.status, 204);
  assert.equal(await empty.text(), '');
});

test('the timeout still covers reading the body and invalid UTF-8 is rejected', async t => {
  usePhoneResponse(t);
  await assert.rejects(boundedFetch('https://team.test', {}, 10, async (_, { signal }) => ({
    status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
    arrayBuffer: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('timed out')), { once: true })),
  })), /timed out/);
  await assert.rejects(boundedFetch('https://team.test', {}, 1000,
    async () => new FetchResponse(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } })), /encoded data|encoding/i);
});
