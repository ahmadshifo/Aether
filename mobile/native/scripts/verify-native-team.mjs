// Called by verify-team.py with a synthetic account over stdin. Never log credentials.
import assert from 'node:assert/strict';
import { createAuthClient } from '../src/auth/authClient.ts';
import { AuthController } from '../src/auth/authController.ts';
import { createTeamApi } from '../src/services/teamApi.ts';
import { StreamRegistry } from '../src/streaming/registry.ts';
import { probeBackend } from '../src/platform/config.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input), origin = 'http://127.0.0.1:8002', cookies = new Map();
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
  await assert.rejects(api.ask({ session_id: id, question_id: crypto.randomUUID(), question: 'Read the sign', language: 'en' }, new AbortController().signal), /answers_unavailable/);
} finally { await registry.request('stop', id); await auth.logout(); }
assert.equal(auth.getSnapshot().status, 'signed_out'); auth.dispose();
console.log('Native production clients passed live HTTP: probe, login, profile, stream Start/Stop, missing-answer handling, logout. Device cookie storage remains untested.');
