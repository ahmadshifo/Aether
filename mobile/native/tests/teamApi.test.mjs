import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamApi, inspectTeamApi, parseAnswer } from '../src/services/teamApi.ts';
import { probeBackend, restoreConnection } from '../src/platform/config.ts';
import { StreamRegistry } from '../src/streaming/registry.ts';
const request = () => ({ session_id: crypto.randomUUID(), question_id: crypto.randomUUID(), question: 'اقرأ اللافتة', language: 'ar' });
const response = r => ({ question_id: r.question_id, language: r.language, answer: 'لا أستطيع قراءة اللافتة.', uncertain: true, evidence_frame_ids: [crypto.randomUUID()] });
test('team ask sends exact contract and cookies; preserves uncertainty, Arabic and evidence', async () => {
  const body = request(), answer = response(body);
  const client = createTeamApi('https://team.test', async (url, options) => {
    assert.equal(url, 'https://team.test/api/v1/ask'); assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error'); assert.deepEqual(JSON.parse(options.body), body);
    return Response.json(answer);
  });
  assert.deepEqual(await client.ask(body, new AbortController().signal), answer);
});
test('rejects mismatched or malformed answers instead of presenting them as real', () => {
  const r = request(), a = response(r);
  for (const patch of [{ question_id: crypto.randomUUID() }, { language: 'en' }, { answer: ' ' }, { uncertain: undefined }, { evidence_frame_ids: ['private/file.jpg'] }]) assert.throws(() => parseAnswer({ ...a, ...patch }, r), /answer_invalid/);
});
test('missing API never falls back to a demo; 401 invalidates account, timeout and abort are bounded', async () => {
  let locked = 0;
  for (const [status, error] of [[404, 'answers_unavailable'], [501, 'answers_unavailable'], [401, 'auth_lost'], [429, 'server_busy'], [503, 'server_unavailable']]) {
    const client = createTeamApi('https://team.test', async () => new Response('{}', { status }), () => locked++);
    await assert.rejects(client.ask(request(), new AbortController().signal), new RegExp(error));
  }
  assert.equal(locked, 1);
  const client = createTeamApi('https://team.test', (_, options) => new Promise((_, reject) => {
    if (options.signal.aborted) reject(Error('abort'));
    else options.signal.addEventListener('abort', () => reject(Error('abort')), { once: true });
  }), () => {}, 15);
  await assert.rejects(client.ask(request(), new AbortController().signal), /server_unavailable/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(client.ask(request(), abort.signal), /cancelled/);
});
test('shared backend works without health, rejects unrelated servers, and migrates retired addresses', async () => {
  await probeBackend('https://team.test', async url => { assert.match(url, /auth\/me$/); return Response.json({ error: { code: 'not_authenticated' } }, { status: 401 }); });
  await assert.rejects(probeBackend('https://team.test', async () => new Response(null, { status: 404 })), /backend_unavailable/);
  const old = restoreConnection({ backend: 'http://192.168.1.2:18063', media: 'http://192.168.1.2:8889', allowLan: true });
  assert.equal(old.needsConfirmation, true); assert.equal(old.endpoints.backend, 'http://192.168.1.2:8002');
  assert.equal(restoreConnection(old.endpoints).needsConfirmation, false);
});
test('capability report distinguishes missing routes from unreachable schema', async () => {
  assert.deepEqual(await inspectTeamApi('https://team.test', async () => Response.json({ paths: { '/api/v1/auth/me': { patch: {} }, '/api/v1/streams/start': { post: {} } } })), { answers: 'missing', history: 'missing', profile: 'available', streams: 'available' });
  assert.equal((await inspectTeamApi('https://team.test', async () => { throw Error(); })).answers, 'unknown');
});
test('profile patch validates identity and trimmed Unicode name', async () => {
  const id = crypto.randomUUID(), user = { user_id: id, name: 'حسن', email: 'test@example.test', created_at: new Date().toISOString() };
  const api = createTeamApi('https://team.test', async (url, options) => {
    assert.match(url, /auth\/me$/); assert.equal(options.method, 'PATCH'); assert.deepEqual(JSON.parse(options.body), { name: 'حسن' }); return Response.json({ user });
  });
  assert.deepEqual(await api.updateName(' حسن ', id, new AbortController().signal), user);
  await assert.rejects(api.updateName('حسن', crypto.randomUUID(), new AbortController().signal), /profile_invalid/);
  await assert.rejects(api.updateName(' ', id, new AbortController().signal), /invalid_name/);
});
test('registry serializes Stop after Start and remains usable after failure', async () => {
  const id = crypto.randomUUID(), calls = []; let release;
  const registry = new StreamRegistry('https://team.test', async url => {
    calls.push(url); if (url.endsWith('/start')) await new Promise(resolve => { release = resolve; });
    return url.endsWith('/start') ? Response.json({ session: { session_id: id, started_at: new Date().toISOString() } }) : new Response(null, { status: 204 });
  });
  const start = registry.request('start', id), stop = registry.request('stop', id);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 1); release();
  await Promise.all([start, stop]); assert.equal(calls.length, 2); assert.match(calls[1], /stop$/);
  let locked = false; const failed = new StreamRegistry('https://team.test', async () => new Response(null, { status: 401 }), () => { locked = true; });
  await assert.rejects(failed.request('start', id), /auth_lost/); assert.equal(locked, true);
});
