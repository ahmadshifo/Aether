import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalHistoryRepository, LEGACY_KEY, TEXT_KEY, dateGroup, searchHistory, boundItems, RETENTION_MS } from '../src/historyRepository.ts'
import { SnapshotBridge } from '../src/snapshotBridge.ts'

const item = (id, extra = {}) => ({ id, question: `Question ${id}`, answer: `Answer ${id}`, language: 'en', time: 'ambiguous legacy label', ...extra })
function memory(initial = null) {
  let value = initial
  return { read: async () => structuredClone(value), write: async next => { value = structuredClone(next) }, value: () => value }
}
function textStore(seed = {}) {
  const map = new Map(Object.entries(seed))
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }
}

test('legacy migration is idempotent; unknown dates remain unknown; clear never reseeds', async () => {
  const text = textStore({ [LEGACY_KEY]: JSON.stringify([item('old'), item('old')]) })
  const store = memory()
  const first = new LocalHistoryRepository(store, text); await first.settled()
  assert.equal(first.list().length, 1); assert.equal(first.list()[0].createdAt, undefined)
  const second = new LocalHistoryRepository(store, text); await second.settled()
  assert.equal(second.list().length, 1)
  second.clear(); await second.settled()
  const third = new LocalHistoryRepository(store, text); await third.settled()
  assert.deepEqual(third.list(), [])
})
test('late hydration cannot overwrite appended answers, deletion, or clear', async () => {
  let resolve
  const store = { read: () => new Promise(done => { resolve = done }), write: async () => {} }
  const repo = new LocalHistoryRepository(store, textStore())
  repo.upsert(item('new')); repo.remove('old')
  resolve({ revision: 1, items: [item('old'), item('other')] }); await repo.settled()
  assert.deepEqual(repo.list().map(row => row.id), ['new', 'other'])
  const clearing = new LocalHistoryRepository(store, textStore())
  clearing.clear(); clearing.upsert(item('after-clear'))
  resolve({ revision: 2, items: [item('old')] }); await clearing.settled()
  assert.deepEqual(clearing.list().map(row => row.id), ['after-clear'])
})
test('an answer callback does not synchronously wait on storage writes', async () => {
  let writes = 0
  const store = textStore()
  const repo = new LocalHistoryRepository(memory(), { getItem: store.getItem, setItem: (key, value) => { writes++; store.setItem(key, value) } })
  await repo.settled()
  const baseline = writes
  repo.upsert(item('spoken-answer'))
  assert.equal(writes, baseline)
  assert.equal(repo.list()[0].id, 'spoken-answer')
  await repo.settled()
  assert.ok(writes > baseline)
})
test('storage failures preserve text; newer fallback clear overrides stale DB photos', async () => {
  const store = memory({ revision: 1, items: [item('old', { photo: new Blob(['private']) })] })
  const text = textStore()
  const repo = new LocalHistoryRepository(store, text); await repo.settled()
  const failing = { read: store.read, write: async () => { throw new Error('quota') } }
  const broken = new LocalHistoryRepository(failing, text); await broken.settled()
  broken.clear(); await broken.settled()
  assert.equal(broken.getSnapshot().error, true)
  const reopened = new LocalHistoryRepository(store, text); await reopened.settled()
  assert.deepEqual(reopened.list(), [])
  const blocked = new LocalHistoryRepository({ read: async () => { throw Error('blocked') }, write: failing.write }, text)
  blocked.upsert(item('text-only')); await blocked.settled()
  assert.equal(blocked.list()[0].id, 'text-only')
  assert.equal(JSON.parse(text.getItem(TEXT_KEY)).items[0].id, 'text-only')
})
test('delete/undo restores image, fields and anchored order; clear owns no orphan blobs', async () => {
  const photo = new Blob(['image'], { type: 'image/jpeg' })
  const saved = item('two', { photo, createdAt: new Date().toISOString(), capturedAt: 'capture' })
  const store = memory({ revision: 1, items: [item('one'), saved, item('three')] })
  const repo = new LocalHistoryRepository(store, textStore()); await repo.settled()
  repo.remove('two'); repo.upsert(item('new')); repo.restore(saved, 1, 'three'); await repo.settled()
  assert.deepEqual(repo.list().map(row => row.id), ['new', 'one', 'two', 'three'])
  assert.equal(await repo.list()[2].photo.text(), 'image')
  assert.equal(repo.list()[2].capturedAt, 'capture')
  repo.clear(); await repo.settled(); assert.deepEqual(store.value().items, [])
})
test('50-entry and byte caps; explicit retention only for known new dates', () => {
  assert.equal(boundItems(Array.from({ length: 55 }, (_, i) => item(`${i}`))).length, 50)
  assert.equal(boundItems([item('large', { photo: new Blob([new Uint8Array(1_500_001)]) })])[0].photo, undefined)
  const now = Date.now()
  assert.deepEqual(boundItems([item('legacy'), item('old', { createdAt: new Date(now - RETENTION_MS).toISOString() })], now).map(row => row.id), ['legacy'])
})
test('undo of the last or only record keeps its original order when a new answer arrives', async () => {
  const repo = new LocalHistoryRepository(memory({ revision: 1, items: [item('first'), item('last')] }), textStore())
  await repo.settled()
  repo.remove('last'); repo.upsert(item('new')); repo.restore(item('last'), 1, undefined, 'first')
  assert.deepEqual(repo.list().map(row => row.id), ['new', 'first', 'last'])
  repo.clear(); repo.upsert(item('only')); repo.remove('only'); repo.upsert(item('newer')); repo.restore(item('only'), 0)
  assert.deepEqual(repo.list().map(row => row.id), ['newer', 'only'])
})
test('calendar grouping and accent/Arabic search preserve displayed content', () => {
  const now = new Date(2026, 2, 9, 0, 10)
  assert.equal(dateGroup(item('today', { createdAt: new Date(2026, 2, 9).toISOString() }), now), 'today')
  assert.equal(dateGroup(item('yesterday', { createdAt: new Date(2026, 2, 8, 23).toISOString() }), now), 'yesterday')
  assert.equal(dateGroup(item('legacy', { time: '9/3/26' }), now), 'earlier')
  const arabic = item('ar', { question: 'ما لَوْن الكتاب؟', language: 'ar' })
  assert.equal(searchHistory([arabic], 'لون')[0], arabic)
  assert.equal(searchHistory([item('cafe', { answer: 'Café' })], 'CAFE').length, 1)
})
test('snapshot bridge returns the same Blob and consumes it once only for matching question/session/language', async () => {
  const bridge = new SnapshotBridge(); bridge.reset()
  const photo = new Blob(['jpeg'])
  assert.equal(await bridge.capture(async () => photo, 'session', 'Question a', 'en'), photo)
  assert.equal(bridge.consume(item('a'), 'session').photo, photo)
  assert.equal(bridge.consume(item('a'), 'session').photo, undefined)
  await bridge.capture(async () => photo, 'session', 'other question', 'ar')
  assert.equal(bridge.consume(item('a'), 'session').photo, undefined)
  await bridge.capture(async () => photo, 'old', 'Question a', 'en')
  assert.equal(bridge.consume(item('a'), 'new').photo, undefined)
})
test('late capture after cancellation, stop, language change or unmount cannot attach an old photo', async () => {
  const bridge = new SnapshotBridge(); bridge.reset()
  let resolve
  const capture = bridge.capture(() => new Promise(done => { resolve = done }), 's', 'Question a', 'en')
  bridge.cancel(); resolve(new Blob(['old'])); await capture
  assert.equal(bridge.consume(item('a'), 's').photo, undefined)
  await bridge.capture(async () => new Blob(['after pause']), 's', 'Question a', 'en')
  assert.equal(bridge.consume(item('a'), 's').photo, undefined)
  bridge.reset()
  const pending = bridge.capture(() => new Promise(done => { resolve = done }), 's', 'Question a', 'en')
  bridge.reset(); resolve(new Blob(['old language'])); await pending
  assert.equal(bridge.consume(item('a'), 's').photo, undefined)
})
