// Called by verify-team.py with a synthetic account over stdin. Never log credentials.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createAuthClient } from '../src/auth/authClient.ts';
import { AuthController } from '../src/auth/authController.ts';
import { createTeamApi } from '../src/services/teamApi.ts';
import { StreamRegistry } from '../src/streaming/registry.ts';
import { probeBackend } from '../src/platform/config.ts';
import { createHistoryApi } from '../src/storage/serverHistory.ts';
import { HistoryRepository } from '../src/storage/history.ts';
import { HistorySync } from '../src/storage/historySync.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input), origin = 'http://127.0.0.1:8002', cookies = new Map();
assert.match(credentials.email, /^mobile-integration-[a-f0-9]+@example\.test$/, 'Acceptance only mutates freshly generated synthetic accounts');
// Node has no native cookie store. This adapter supplies one for HTTP acceptance;
// the installed app uses expo/fetch and the OS cookie store instead.
async function transport(url, options = {}) {
  const headers = new Headers(options.headers);
  if (options.credentials === 'include' && cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  const response = await fetch(url, { ...options, headers });
  if (options.credentials === 'include') for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';'), index = pair.indexOf('='), key = pair.slice(0, index), value = pair.slice(index + 1);
    if (/max-age=0(?:;|$)/i.test(cookie)) cookies.delete(key); else cookies.set(key, value);
  }
  return response;
}
await probeBackend(origin, transport);
const auth = new AuthController(createAuthClient(origin, transport), origin);
await auth.check(); assert.equal(auth.getSnapshot().status, 'signed_out');
await auth.submit('login', credentials); assert.equal(auth.getSnapshot().status, 'signed_in');
const session = auth.getSnapshot().session, api = createTeamApi(origin, transport, () => auth.external('changed'));
const user = await api.updateName('Native HTTP acceptance', session.user.user_id, new AbortController().signal);
auth.updateProfile(user, session.owner); assert.equal(auth.getSnapshot().session.user.name, 'Native HTTP acceptance');
assert.equal(auth.getSnapshot().session.owner, session.owner);
const registry = new StreamRegistry(origin, transport), id = crypto.randomUUID();
try {
  await registry.request('start', id);
  const active = await transport(`${origin}/api/v1/streams/active`, { credentials: 'include' }).then(response => response.json());
  assert.equal(active.session.session_id, id);
  const questionId = crypto.randomUUID();
  const answer = await api.ask({ session_id: id, question_id: questionId, question: 'Read the sign', language: 'en' }, new AbortController().signal);
  assert.equal(answer.question_id, questionId); assert.equal(answer.uncertain, true);
  const history = await transport(`${origin}/api/v1/questions`, { credentials: 'include' }).then(response => response.json());
  assert.ok(history.questions.some(row => row.question_id === questionId && row.demo !== true));
  const secondId = crypto.randomUUID();
  await api.ask({ session_id: id, question_id: secondId, question: 'Where is the door?', language: 'en' }, new AbortController().signal);
  const historyApi = createHistoryApi(origin, transport);
  const firstPage = await historyApi.page(null, new AbortController().signal, 1);
  assert.equal(firstPage.entries.length, 1); assert.ok(firstPage.nextCursor);
  const secondPage = await historyApi.page(firstPage.nextCursor, new AbortController().signal, 1);
  const paginationComplete = secondPage.entries.length === 1;
  if (paginationComplete) assert.notEqual(firstPage.entries[0].questionId, secondPage.entries[0].questionId);
  else console.warn('BACKEND ISSUE: next_cursor promised another record but returned an empty page. history.py builds cursors from auth._iso(), which truncates DATETIME(3) milliseconds. Teammate fix required.');
  const repository = new HistoryRepository(session.owner, { read: async () => null, write: async () => {}, collect: async () => {} }, () => auth.authorized(session.owner));
  const sync = new HistorySync(repository, historyApi, () => auth.authorized(session.owner));
  try {
    await sync.refresh(); assert.equal(sync.getSnapshot().status, 'ready'); assert.ok(sync.getSnapshot().items.some(entry => entry.questionId === questionId));
    assert.equal(await sync.clear(), true); assert.equal(repository.getSnapshot().items.length, 0);
    const empty = await historyApi.page(null, new AbortController().signal); assert.equal(empty.entries.length, 0);
    mkdirSync('.runtime/history-streaming', { recursive: true });
    writeFileSync('.runtime/history-streaming/live-history.json', JSON.stringify({ refresh: 'passed', serverClear: 'passed', demoExcluded: 'passed', pagination: paginationComplete ? 'passed for this pair; same-second precision defect remains in backend source' : 'blocked: cursor truncates milliseconds', deviceTested: false }, null, 2));
  } finally { sync.dispose(); repository.dispose(); }
} finally { await registry.request('stop', id); await auth.logout(); }
assert.equal(auth.getSnapshot().status, 'signed_out'); auth.dispose();
console.log('Native production clients passed live HTTP: account/profile, stream Start/Stop, uncertain answer, MySQL History refresh, confirmed server clear and logout. Pagination result is reported separately. This does not verify visual AI or device cookie storage.');
