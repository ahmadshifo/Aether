import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lifetime } from '../src/session/Lifetime';
import { words, selectLocale } from '../src/i18n/words';
import { parseHistory, prependHistory } from '../src/storage/history';
import { ask } from '../src/session/ask';
import type { HistoryItem } from '../src/types';

test('late camera acquisitions are released after Stop; Stop is idempotent', async () => {
  const life = new Lifetime(); let releases = 0;
  let resolve!: () => void;
  const acquisition = new Promise<void>(done => { resolve = done; });
  const pending = acquisition.then(() => life.own(() => { releases++; }));
  life.stop(); life.stop(); resolve(); await pending;
  assert.equal(life.active, false); assert.equal(releases, 1);
});
test('repeated Start/Stop releases independent sessions even if one cleanup fails', () => {
  let releases = 0;
  for (let i = 0; i < 20; i++) {
    const life = new Lifetime(); life.own(() => { releases++; }); life.own(() => { throw Error(); });
    life.stop(); life.stop(); assert.equal(life.controller.signal.aborted, true);
  }
  assert.equal(releases, 20);
});
const item: HistoryItem = { id: '1', question: 'سؤال', answer: 'إجابة', language: 'ar', demo: false, time: new Date(0).toISOString() };
test('storage rejects malformed entries, deduplicates and caps history at 50', () => {
  assert.deepEqual(parseHistory('{bad'), []);
  assert.deepEqual(parseHistory(JSON.stringify([{}, item, item, { ...item, id: 'bad', time: 'bad' } ])), [item]);
  let history: HistoryItem[] = [];
  for (let i = 0; i < 55; i++) history = prependHistory(history, { ...item, id: String(i) });
  assert.equal(history.length, 50); assert.equal(history[0]?.id, '54');
});
test('translations have identical keys and supported locale selection never swaps language', () => {
  assert.deepEqual(Object.keys(words.en).sort(), Object.keys(words.ar).sort());
  assert.equal(selectLocale(['en-US', 'ar-SA', 'ar-LB'], 'ar'), 'ar-LB');
  assert.equal(selectLocale(['en-US'], 'ar'), undefined);
});
test('ask sends immutable JSON contract and shared session UUID', async () => {
  let body: unknown;
  const request = (async (url, init) => {
    assert.equal(url, 'http://192.0.2.1:8002/api/v1/ask'); body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ question_id: 'q', answer: 'Answer', language: 'en', uncertain: false, evidence_frame_ids: [] }));
  }) as typeof fetch;
  assert.equal(await ask('http://192.0.2.1:8002/', 'shared-session', 'q', 'What?', 'en', new AbortController().signal, request), 'Answer');
  assert.deepEqual(body, { session_id: 'shared-session', question_id: 'q', question: 'What?', language: 'en' });
});
test('ask rejects mismatched response identity and propagates cancellation', async () => {
  await assert.rejects(ask('https://example.com', 's', 'q', 'Question', 'ar', new AbortController().signal,
    (async () => new Response(JSON.stringify({ answer: 'wrong' }))) as typeof fetch), /api-v1/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ask('https://example.com', 's', 'q', 'Question', 'en', controller.signal,
    (async (_url, options) => { options?.signal?.throwIfAborted(); return new Response(); }) as typeof fetch));
});
