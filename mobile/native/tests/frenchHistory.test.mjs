import test from 'node:test';
import assert from 'node:assert/strict';
import { toEntry, fetchServerHistory } from '../src/storage/serverHistory.ts';
import { boundEntries } from '../src/storage/history.ts';
import { createTeamApi } from '../src/services/teamApi.ts';
const row = () => ({ question_id: crypto.randomUUID(), session_id: crypto.randomUUID(), asked_at: new Date().toISOString(), language: 'fr', question: 'Où est la porte ?', answer: 'Je ne peux pas encore décrire cette image.', uncertain: true, evidence_frame_ids: [crypto.randomUUID()], demo: false });
test('French server history survives validation and persistence without losing evidence', () => {
  const q = row(), entry = toEntry(q);
  assert.equal(entry.language, 'fr'); assert.equal(entry.provenance, 'server');
  assert.deepEqual(boundEntries([entry])[0].evidenceFrameIds, q.evidence_frame_ids);
  for (const patch of [{ demo: true }, { uncertain: undefined }, { evidence_frame_ids: ['private/path'] }, { language: 'de' }]) assert.equal(toEntry({ ...q, ...patch }), null);
});
test('sample server history never becomes real account history', async () => {
  assert.equal(await fetchServerHistory('https://team.test', async () => Response.json({ questions: [row()], demo: true })), null);
  const result = await fetchServerHistory('https://team.test', async () => Response.json({ questions: [row(), { ...row(), demo: true }], demo: false }));
  assert.equal(result.entries.length, 1);
});
test('French ask is sent unchanged; rejected French is explicit and never retried in English', async () => {
  const q = row(), req = { session_id: q.session_id, question_id: q.question_id, question: q.question, language: 'fr' };
  let calls = 0;
  const api = createTeamApi('https://team.test', async (_, init) => { calls++; assert.deepEqual(JSON.parse(init.body), req); return Response.json({ error: { message: 'Missing or invalid field: language.' } }, { status: 422 }); });
  await assert.rejects(api.ask(req, new AbortController().signal), /server_language_unavailable/); assert.equal(calls, 1);
  const ready = createTeamApi('https://team.test', async () => Response.json(q));
  assert.equal((await ready.ask(req, new AbortController().signal)).language, 'fr');
});
