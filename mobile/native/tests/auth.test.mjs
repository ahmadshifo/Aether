import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthController } from '../src/auth/authController.ts';
import { createAuthClient, validateAuth, AuthError } from '../src/auth/authClient.ts';
const a = { user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Synthetic A', email: 'a@example.test', created_at: new Date().toISOString() };
const input = () => ({ name: 'Synthetic', email: 'a@example.test', password: crypto.randomUUID() });
const client = changes => ({ me: async () => a, login: async () => a, signup: async () => a, logout: async () => {}, ...changes });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('native auth transport: explicit origin, credentials/include, no redirects, validated identity and outages', async () => {
  const calls = [], origin = 'https://fixture.example';
  const api = createAuthClient(origin, async (url, options) => { calls.push({ url, options }); return new Response(url.endsWith('logout') ? null : JSON.stringify({ user: a }), { status: url.endsWith('logout') ? 204 : url.endsWith('signup') ? 201 : 200 }); });
  const credentials = input(); await api.signup(credentials); await api.me(); await api.logout(); await api.login(credentials);
  calls.forEach(({ url, options }) => { assert.ok(url.startsWith(origin + '/api/v1/auth/')); assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); });
  assert.deepEqual(Object.keys(JSON.parse(calls[3].options.body)).sort(), ['email', 'password']);
  await assert.rejects(createAuthClient(origin, async () => new Response('{}')).me(), { code: 'malformed' });
  assert.equal(await createAuthClient(origin, async () => new Response('{}', { status: 401 })).me(), null);
  await assert.rejects(createAuthClient(origin, async () => new Response('{}', { status: 503 })).login(credentials), { code: 'unavailable' });
  await assert.rejects(createAuthClient(origin, async () => { throw Error('offline'); }).me(), { code: 'unavailable' });
});
test('auth validation retains Unicode-code-point and exact password semantics', () => {
  const credentials = input(); assert.equal(validateAuth('signup', credentials, credentials.password), '');
  assert.equal(validateAuth('signup', { ...credentials, password: '😀'.repeat(7) }, '😀'.repeat(7)), 'weak_password');
  assert.equal(validateAuth('signup', { ...credentials, password: ' '.repeat(8) }, ' '.repeat(8)), '');
  assert.equal(validateAuth('signup', credentials, 'different'), 'mismatch');
});
test('identity locks synchronously, keeps same owner on recheck, rejects cancelled/late submits', async () => {
  const c = new AuthController(client(), 'fixture-A'); await c.check(); const owner = c.getSnapshot().session.owner;
  await c.check(); assert.equal(c.getSnapshot().session.owner, owner);
  c.onLock(() => assert.equal(c.authorized(owner), false)); c.background(); assert.equal(c.authorized(owner), false); await c.check();
  c.dispose(); assert.equal(c.authorized(owner), false);
  const gate = deferred(); let calls = 0;
  const next = new AuthController(client({ me: async () => null, login: () => { calls++; return gate.promise; } }), 'fixture-B'); await next.check();
  const pending = next.submit('login', input()); await next.submit('login', input()); next.cancelSubmit(); gate.resolve(a); await pending;
  assert.equal(calls, 1); assert.equal(next.getSnapshot().session, null); assert.equal(next.getSnapshot().status, 'service_unavailable');
});
test('uncertain mutation reconciles without retry; failed logout stays locked even if /me still returns user', async () => {
  let account = null, posts = 0;
  const c = new AuthController(client({ me: async () => account, signup: async () => { posts++; account = a; throw new AuthError('timeout', 0, true); }, logout: async () => { throw Error(); } }), 'fixture');
  await c.check(); await c.submit('signup', input()); assert.equal(posts, 1); assert.equal(c.getSnapshot().status, 'signed_in');
  await c.logout(); assert.equal(c.getSnapshot().status, 'logout_failed'); await c.check(); assert.equal(c.getSnapshot().status, 'logout_failed');
  account = null; await c.check(); assert.equal(c.getSnapshot().status, 'signed_out');
});
test('endpoint change requires explicit fresh authentication across foreground events', async () => {
  let checks = 0; const c = new AuthController(client({ me: async () => { checks++; return a; } }), 'new-fixture');
  c.requireFresh(); c.background(); await c.check(); assert.equal(checks, 0); assert.equal(c.getSnapshot().status, 'signed_out');
  await c.submit('login', input()); assert.equal(c.getSnapshot().session.owner.source, 'new-fixture');
});
