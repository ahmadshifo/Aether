// Disposable synthetic credentials; only this run's fixture user is removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const origin = 'http://127.0.0.1:18063';
const health = await fetch(`${origin}/health`).then(response => response.json());
assert.equal(health.service, 'aether-native-fixture'); assert.equal(health.storage, 'sqlite');
const input = { name: 'Disposable native smoke', email: `native-smoke-${randomUUID()}@example.test`, password: randomUUID() };
let cookie = '', userId;
async function request(route, body) {
  const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return response;
}
try {
  const signup = await request('/api/v1/auth/signup', input); assert.equal(signup.status, 201); userId = (await signup.json()).user.user_id;
  assert.equal((await request('/api/v1/auth/me')).status, 200);
  assert.equal((await request('/api/v1/auth/logout', {})).status, 204);
  assert.equal((await request('/api/v1/auth/me')).status, 401);
  assert.equal((await request('/api/v1/auth/login', input)).status, 200);
  assert.equal((await request('/api/v1/auth/logout', {})).status, 204);
  assert.equal((await request('/api/v1/auth/me')).status, 401);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), fixture: 'healthy', signup: 201, me: 200, login: 200, logout: 204, revokedMe: 401, runtime: 'Node HTTP, not native cookie store' }));
} finally {
  if (userId) {
    const db = new DatabaseSync(fileURLToPath(new URL('../.runtime/accounts.sqlite3', import.meta.url)));
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const stored = db.prepare('SELECT email FROM users WHERE user_id=?').get(userId);
    if (stored?.email === input.email) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); db.prepare('DELETE FROM users WHERE user_id=? AND email=?').run(userId, input.email); }
    db.close();
  }
}
