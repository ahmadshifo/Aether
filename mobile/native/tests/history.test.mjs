import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRepository, boundEntries, namespace, RETENTION_MS, searchHistory, dateGroup } from '../src/storage/history.ts';
const owner = id => ({ source: 'https://fixture.example|environment', userId: `${id.repeat(8)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(12)}`, epoch: 1 });
const row = (id, extra = {}) => ({ id, sessionId: crypto.randomUUID(), questionId: crypto.randomUUID(), question: 'Read the sign', answer: 'Room 205', language: 'en', input: 'speech', demo: true, createdAt: new Date().toISOString(), ...extra });
function memory() { const map = new Map(), collected = []; return { map, collected, read: async key => map.get(key) ?? null, write: async (key, value) => { map.set(key, value); }, collect: async (key, keep) => { collected.push({ key, keep }); } }; }
test('verified-owner gate, account A/B and environment isolation; retired writes cannot enter another owner', async () => {
  const store = memory(); assert.throws(() => new HistoryRepository(owner('a'), store, () => false));
  const a = new HistoryRepository(owner('a'), store, () => true), b = new HistoryRepository(owner('b'), store, () => true); await Promise.all([a.ready, b.ready]);
  a.upsert(row('private-A')); b.upsert(row('private-B')); await Promise.all([a.settled(), b.settled()]); a.dispose(); a.upsert(row('late'));
  const reopened = new HistoryRepository(owner('a'), store, () => true); await reopened.ready;
  assert.deepEqual(reopened.getSnapshot().items.map(x => x.id), ['private-A']); assert.deepEqual(b.getSnapshot().items.map(x => x.id), ['private-B']);
  assert.notEqual(namespace(owner('a')), namespace({ ...owner('a'), source: 'other-environment' }));
  assert.throws(() => namespace({ source: 'x', userId: '../other' }));
});
test('hydration journal preserves appended/deleted answers and corruption stays visibly unavailable', async () => {
  let resolve; const store = memory(); store.read = () => new Promise(done => { resolve = done; });
  const repo = new HistoryRepository(owner('a'), store, () => true); await Promise.resolve();
  repo.upsert(row('new')); repo.clear(); repo.upsert(row('after-clear')); resolve(JSON.stringify({ revision: 1, items: [row('old')] })); await repo.settled();
  assert.deepEqual(repo.getSnapshot().items.map(x => x.id), ['after-clear']);
  const broken = memory(); broken.map.set(namespace(owner('b')), '{broken'); const bad = new HistoryRepository(owner('b'), broken, () => true); await bad.ready;
  assert.equal(bad.getSnapshot().error, true); assert.equal(broken.map.get(bad.key), '{broken');
});
test('delete/Undo preserves order and photo lease; Clear invalidates Undo and eligible image retention', async () => {
  const store = memory(), repo = new HistoryRepository(owner('a'), store, () => true); await repo.ready;
  const photo = { path: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', bytes: 100, capturedAt: new Date().toISOString() };
  repo.upsert(row('old')); repo.upsert(row('photo', { photo })); repo.upsert(row('top')); repo.remove('photo'); repo.upsert(row('new'));
  await repo.settled(); assert.ok(store.collected.at(-1).keep.includes(photo.path)); repo.restore(); await repo.settled();
  assert.deepEqual(repo.getSnapshot().items.map(x => x.id), ['new', 'top', 'photo', 'old']);
  repo.remove('photo'); repo.clear(); repo.restore(); await repo.settled(); assert.deepEqual(repo.getSnapshot().items, []); assert.deepEqual(store.collected.at(-1).keep, []);
});
test('50/24h/1.5MB/20MB bounds, path safety, normalized EN/AR search and calendar grouping', () => {
  const entries = Array.from({ length: 60 }, (_, i) => row(String(i), { photo: { path: `${i}.jpg`, bytes: 1500000, capturedAt: new Date().toISOString() } }));
  const bounded = boundEntries(entries); assert.equal(bounded.length, 50); assert.equal(bounded.filter(x => x.photo).length, 13);
  assert.equal(boundEntries([row('old', { createdAt: new Date(Date.now() - RETENTION_MS).toISOString() })]).length, 0);
  assert.equal(boundEntries([row('photo', { photo: { path: '../secret.jpg', bytes: 10, capturedAt: new Date().toISOString() } })])[0].photo, undefined);
  assert.equal(searchHistory([row('ar', { question: 'أمامَ الباب', language: 'ar' })], 'امام').length, 1);
  assert.equal(dateGroup(row('today')), 'today');
});
test('disk failure preserves in-memory text and sets error; disposal during hydration publishes nothing', async () => {
  const store = memory(); store.write = async () => { throw Error('full'); };
  const repo = new HistoryRepository(owner('a'), store, () => true); await repo.ready; repo.upsert(row('text')); await repo.settled();
  assert.equal(repo.getSnapshot().items[0].id, 'text'); assert.equal(repo.getSnapshot().error, true);
  let release; const slow = { ...memory(), read: () => new Promise(resolve => { release = resolve; }) };
  const retired = new HistoryRepository(owner('b'), slow, () => true); await Promise.resolve(); retired.dispose(); release(JSON.stringify({ revision: 1, items: [row('late')] })); await retired.ready;
  assert.deepEqual(retired.getSnapshot().items, []);
});
