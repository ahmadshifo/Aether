import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthError, createAuthClient, validateAuth } from '../src/authClient.ts'
import { AuthController } from '../src/authController.ts'
import { LocalHistoryRepository, historyNamespace, LEGACY_KEY, TEXT_KEY, RETENTION_MS } from '../src/historyRepository.ts'

const user = id => ({ user_id: `${id.repeat(8)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(12)}`, email: `${id}@example.test`, name: `Test ${id}`, created_at: '2026-11-02T00:00:00Z' })
const a = user('a'), b = user('b')
const credentials = () => ({ name: 'Synthetic', email: 'synthetic@example.test', password: crypto.randomUUID() })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fakeClient(overrides = {}) { return { me: async () => null, login: async () => a, signup: async () => a, logout: async () => {}, ...overrides } }
const response = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('typed client: relative paths, no-store, exact password, same-origin cookie and 204', async () => {
  const calls = []
  const client = createAuthClient(async (path, options) => { calls.push({ path, options }); return path.endsWith('logout') ? response(204) : response(path.endsWith('signup') ? 201 : 200, { user: a }) })
  const input = credentials(); input.password = ` ${input.password} `
  assert.deepEqual(await client.signup(input), a)
  await client.me(); await client.logout()
  await client.login(input)
  assert.equal(JSON.parse(calls[0].options.body).password, input.password)
  for (const { path, options } of calls) { assert.match(path, /^\/api\/v1\/auth\//); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'same-origin') }
  assert.equal(calls[2].options.method, 'POST')
  assert.deepEqual(Object.keys(JSON.parse(calls[3].options.body)).sort(), ['email', 'password'])
})
test('only /me 401 establishes signed-out; login 401 and 429 preserve error codes', async () => {
  assert.equal(await createAuthClient(async () => response(401)).me(), null)
  for (const [status, code] of [[401, 'invalid_credentials'], [429, 'too_many_attempts'], [409, 'email_taken']]) {
    await assert.rejects(createAuthClient(async () => response(status, { error: { code } })).login(credentials()), error => error.status === status && error.code === code)
  }
})
test('malformed identity, missing fields, invalid UUID and non-JSON never authenticate', async () => {
  for (const value of [{}, { user: { ...a, user_id: '../b' } }, { user: { ...a, created_at: 'invalid' } }, { user: { ...a, name: null } }]) {
    await assert.rejects(createAuthClient(async () => response(200, value)).me(), { code: 'malformed' })
  }
  await assert.rejects(createAuthClient(async () => new Response('HTML')).me(), { code: 'malformed' })
})
test('request timeout and cancellation abort actual fetch, with uncertain mutation outcome', async () => {
  const fetcher = async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  await assert.rejects(createAuthClient(fetcher, 5).me(), { code: 'timeout', uncertain: false })
  await assert.rejects(createAuthClient(fetcher, 5).signup(credentials()), { code: 'timeout', uncertain: true })
  const abort = new AbortController()
  const pending = createAuthClient(fetcher).login(credentials(), abort.signal); abort.abort()
  await assert.rejects(pending, { code: 'cancelled', uncertain: true })
})
test('API-matched validation, Unicode length, confirmation and exact whitespace', () => {
  const input = credentials()
  assert.equal(validateAuth('signup', input, input.password), '')
  assert.equal(validateAuth('signup', input, 'different'), 'mismatch')
  assert.equal(validateAuth('signup', { ...input, name: ' ' }, input.password), 'invalid_name')
  assert.equal(validateAuth('signup', { ...input, email: 'invalid' }, input.password), 'invalid_email')
  assert.equal(validateAuth('signup', { ...input, password: '😀'.repeat(7) }, '😀'.repeat(7)), 'weak_password')
  assert.equal(validateAuth('signup', { ...input, password: ' '.repeat(8) }, ' '.repeat(8)), '')
  assert.equal(validateAuth('login', { ...input, password: '' }, ''), 'password_required')
})
test('boot and outages stay locked; valid server response alone establishes owner', async () => {
  const gate = deferred(); const controller = new AuthController(fakeClient({ me: () => gate.promise }))
  const checking = controller.check()
  assert.equal(controller.getSnapshot().session, null)
  assert.equal(controller.getSnapshot().status, 'checking')
  gate.resolve(a); await checking
  assert.equal(controller.authorized(controller.getSnapshot().session.owner), true)
  for (const error of [new AuthError('unavailable', 503), new AuthError('timeout'), new AuthError('malformed')]) {
    const unavailable = new AuthController(fakeClient({ me: async () => { throw error } }))
    await unavailable.check(); assert.equal(unavailable.getSnapshot().status, 'service_unavailable'); assert.equal(unavailable.getSnapshot().session, null)
  }
})
test('revalidation preserves identity epoch, deduplicates /me and rejects stale results', async () => {
  let next = a, calls = 0
  const controller = new AuthController(fakeClient({ me: async () => { calls++; return next } }))
  await controller.check(); const owner = controller.getSnapshot().session.owner
  await Promise.all([controller.check(), controller.check()]); assert.equal(calls, 2)
  assert.equal(controller.getSnapshot().session.owner, owner)
  const gate = deferred(); next = gate.promise
  const pending = controller.check(); assert.equal(controller.authorized(owner), false)
  controller.external('changing'); gate.resolve(a); await pending
  assert.equal(controller.getSnapshot().session, null)
})
test('repeated submit is one POST, cancelled or stale outcome cannot admit old user', async () => {
  const gate = deferred(); let calls = 0
  const controller = new AuthController(fakeClient({ login: () => { calls++; return gate.promise } }))
  await controller.check()
  const pending = controller.submit('login', credentials())
  await controller.submit('login', credentials()); assert.equal(calls, 1)
  controller.cancelSubmit(); gate.resolve(a); await pending
  assert.equal(controller.getSnapshot().status, 'service_unavailable'); assert.equal(controller.getSnapshot().session, null)
})
test('signup uncertainty reconciles /me; no automatic repeated account creation', async () => {
  let current = null, calls = 0
  const controller = new AuthController(fakeClient({ me: async () => current, signup: async () => { calls++; current = a; throw new AuthError('timeout', 0, true) } }))
  await controller.check(); await controller.submit('signup', credentials())
  assert.equal(calls, 1); assert.equal(controller.getSnapshot().session.user.user_id, a.user_id)
  const unknown = new AuthController(fakeClient({ signup: async () => { throw new AuthError('timeout', 0, true) } }))
  await unknown.check(); await unknown.submit('signup', credentials())
  assert.equal(unknown.getSnapshot().error, 'uncertain'); assert.equal(unknown.getSnapshot().session, null)
})
test('logout locks synchronously before POST; confirmed 204 revokes owner and shows success', async () => {
  let locks = 0
  const controller = new AuthController(fakeClient({ me: async () => a, logout: async () => { assert.equal(locks, 1); assert.equal(controller.getSnapshot().session, null) } }))
  await controller.check(); const owner = controller.getSnapshot().session.owner
  controller.onLock(() => locks++)
  await controller.logout()
  assert.equal(controller.authorized(owner), false); assert.equal(controller.getSnapshot().status, 'signed_out'); assert.equal(controller.getSnapshot().notice, 'signed_out')
})
test('failed/uncertain logout remains locked through /me and retry; no fake success', async () => {
  let current = a, failure = true
  const controller = new AuthController(fakeClient({ me: async () => current, logout: async () => { if (failure) throw new AuthError('timeout', 0, true); current = null } }))
  await controller.check(); await controller.logout()
  assert.equal(controller.getSnapshot().status, 'logout_failed'); assert.equal(controller.getSnapshot().notice, '')
  await controller.check(); assert.equal(controller.getSnapshot().status, 'logout_failed')
  failure = false; await controller.logout(); assert.equal(controller.getSnapshot().status, 'signed_out')
})
test('lost logout response reconciles signed-out 401; changed cookie never reopens locked view', async () => {
  let current = a
  const controller = new AuthController(fakeClient({ me: async () => current, logout: async () => { current = null; throw new AuthError('unavailable', 0, true) } }))
  await controller.check(); await controller.logout(); assert.equal(controller.getSnapshot().notice, 'signed_out')
  current = a; await controller.check(); const oldOwner = controller.getSnapshot().session.owner
  controller.external('changing'); current = b; await controller.check()
  assert.equal(controller.authorized(oldOwner), false); assert.equal(controller.getSnapshot().session.user.user_id, b.user_id)
})

const item = (id, extra = {}) => ({ id, question: `Question ${id}`, answer: `Answer ${id}`, time: '', language: 'en', createdAt: new Date().toISOString(), ...extra })
const owner = id => ({ source: 'synthetic-sqlite-v1', userId: user(id).user_id })
function textStore(seed = {}) { const map = new Map(Object.entries(seed)); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map } }
function memory(initial = null) { let value = initial; return { read: async () => structuredClone(value), write: async next => { value = structuredClone(next) }, value: () => value } }
test('A/B independent stores, photos, return, delete/undo/clear and unclaimed legacy bytes', async () => {
  const legacy = JSON.stringify([item('unclaimed')]); const text = textStore({ [LEGACY_KEY]: legacy, [TEXT_KEY]: JSON.stringify({ revision: 1, items: [item('old-v2')] }) })
  const aStore = memory(), bStore = memory()
  let repoA = new LocalHistoryRepository(aStore, text, owner('a'))
  const repoB = new LocalHistoryRepository(bStore, text, owner('b'))
  await Promise.all([repoA.settled(), repoB.settled()]); assert.deepEqual(repoA.list(), []); assert.deepEqual(repoB.list(), [])
  repoA.upsert(item('A', { photo: new Blob(['synthetic'], { type: 'image/jpeg' }) })); repoB.upsert(item('B'))
  await Promise.all([repoA.settled(), repoB.settled()]); repoA.dispose()
  repoA = new LocalHistoryRepository(aStore, text, owner('a')); await repoA.settled()
  assert.deepEqual(repoA.list().map(row => row.id), ['A']); assert.ok(repoA.list()[0].photo instanceof Blob)
  const deleted = repoA.list()[0]; repoA.remove('A'); repoA.restore(deleted, 0); await repoA.settled()
  repoA.clear(); await repoA.settled(); assert.equal(repoB.list()[0].id, 'B')
  assert.equal(text.getItem(LEGACY_KEY), legacy); assert.match(text.getItem(TEXT_KEY), /old-v2/)
  assert.notEqual(historyNamespace(owner('a')), historyNamespace(owner('b')))
})
test('disposed A late hydration, callbacks and queued writes cannot populate B or old UI', async () => {
  const hydrate = deferred(); const write = deferred(); const text = textStore()
  const delayed = new LocalHistoryRepository({ read: () => hydrate.promise, write: async () => {} }, text, owner('a'))
  let notices = 0; delayed.subscribe(() => notices++); delayed.dispose(); hydrate.resolve({ revision: 1, items: [item('A')] }); await delayed.settled()
  assert.equal(notices, 0); assert.deepEqual(delayed.list(), [])
  const writes = []
  const repoA = new LocalHistoryRepository({ read: async () => null, write: async value => { writes.push(value); await write.promise } }, text, owner('a'))
  await repoA.ready; repoA.upsert(item('A')); await Promise.resolve(); repoA.dispose()
  const repoB = new LocalHistoryRepository(memory(), text, owner('b')); await repoB.settled()
  repoA.upsert(item('late')); write.resolve(); await repoA.settled()
  assert.deepEqual(repoB.list(), []); assert.deepEqual(repoA.list(), []); assert.equal(writes.some(value => value.items.some(row => row.id === 'late')), false)
})
test('per-user quota fallback, partial clear failure and retention never touch other owner', async () => {
  const text = textStore(), aStore = memory({ revision: 1, items: [item('old-A', { photo: new Blob(['synthetic']) })] }), bStore = memory()
  const repoB = new LocalHistoryRepository(bStore, text, owner('b')); await repoB.settled(); repoB.upsert(item('B')); await repoB.settled()
  const broken = new LocalHistoryRepository({ read: aStore.read, write: async () => { throw Error('quota') } }, text, owner('a'))
  await broken.settled(); broken.clear(); await broken.settled(); assert.equal(broken.getSnapshot().error, true)
  const returned = new LocalHistoryRepository(aStore, text, owner('a')); await returned.settled(); assert.deepEqual(returned.list(), [])
  returned.upsert(item('expired', { createdAt: new Date(Date.now() - RETENTION_MS - 1).toISOString() })); await returned.settled()
  assert.deepEqual(returned.list(), []); assert.equal(repoB.list()[0].id, 'B')
})
test('returning to A waits for retired A writes before hydration; clear cannot resurrect them', async () => {
  const gate = deferred(), text = textStore(); let value = null, held = false
  const storage = { read: async () => value, write: async next => { if (held) await gate.promise; value = structuredClone(next) } }
  const first = new LocalHistoryRepository(storage, text, owner('a')); await first.settled()
  held = true; first.upsert(item('A-before-logout')); await Promise.resolve(); first.dispose()
  const returned = new LocalHistoryRepository(storage, text, owner('a'))
  returned.clear(); gate.resolve(); await returned.settled()
  assert.deepEqual(returned.list(), [])
  const reopened = new LocalHistoryRepository(storage, text, owner('a')); await reopened.settled(); assert.deepEqual(reopened.list(), [])
})
