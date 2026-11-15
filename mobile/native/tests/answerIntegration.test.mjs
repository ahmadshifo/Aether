import test from 'node:test';
import assert from 'node:assert/strict';
import { answerEnvironment } from '../scripts/answer-environment.mjs';
import { createTeamApi } from '../src/services/teamApi.ts';

test('launcher selects only private answer provider settings for the AI backend', () => {
  assert.deepEqual(answerEnvironment({ AI_PROVIDER: ' gemini ', GEMINI_API_KEY: 'test-placeholder',
    GEMINI_MODEL: 'model-test', EXPO_PUBLIC_GEMINI_API_KEY: 'never-forward', MYSQL_PASSWORD: 'never-forward' }),
  { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-placeholder', GEMINI_MODEL: 'model-test' });
  assert.deepEqual(answerEnvironment({ GEMINI_API_KEY: ' ', GEMINI_MODEL: null }), {});
});

test('answer request allows first-frame and vision waits but still times out and cancels', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const request = { session_id: crypto.randomUUID(), question_id: crypto.randomUUID(), question: 'Read the sign', language: 'en' };
  const client = createTeamApi('https://team.test', (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  let settled = false;
  const pending = client.ask(request, new AbortController().signal);
  const assertion = assert.rejects(pending.finally(() => { settled = true; }), /server_unavailable/);
  t.mock.timers.tick(25000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(15000);
  await assertion;
  const abort = new AbortController();
  const cancelled = assert.rejects(client.ask(request, abort.signal), /cancelled/);
  abort.abort();
  await cancelled;
});
