import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryRepository } from '../src/storage/history.ts';
import { HistorySync } from '../src/storage/historySync.ts';
import { createHistoryApi, toEntry } from '../src/storage/serverHistory.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = (age = 10000) => ({ question_id: crypto.randomUUID(), session_id: crypto.randomUUID(), asked_at: new Date(Date.now() - age).toISOString(), language: 'en', question: 'Where is the door?', answer: 'A test answer', uncertain: false, evidence_frame_ids: [], demo: false });
async function setup(api, stored = []) {
  let allowed = true, written;
  const repository = new HistoryRepository({ source: 'https://test.example', userId: crypto.randomUUID(), epoch: 1 }, {
    read: async () => JSON.stringify({ items: stored, revision: 1 }), write: async (_, data) => { written = JSON.parse(data); }, collect: async () => {},
  }, () => allowed);
  await repository.ready;
  const sync = new HistorySync(repository, api, () => allowed);
  return { repository, sync, lock: () => { allowed = false; sync.cancel(); }, written: () => written, dispose: () => { sync.dispose(); repository.dispose(); } };
}

test('History paginates beyond the 50-row offline cache, preserves photos and deduplicates live answers by question id', async () => {
  const rows = Array.from({ length: 63 }, (_, i) => row(10000 + i * 1000)), local = { ...toEntry(rows[0]), id: crypto.randomUUID(), input: 'typed', photo: { path: `${crypto.randomUUID()}.jpg`, bytes: 123, capturedAt: rows[0].asked_at } };
  const requests = [];
  const api = createHistoryApi('https://test.example', async (url, options) => {
    requests.push({ url, options }); const cursor = new URL(url).searchParams.get('cursor'), start = cursor ? Number(cursor) : 0;
    return Response.json({ questions: rows.slice(start, start + 20), next_cursor: start + 20 < rows.length ? String(start + 20) : null, demo: false });
  });
  const h = await setup(api, [local]);
  await h.sync.refresh(); while (h.sync.getSnapshot().nextCursor) await h.sync.more();
  const items = h.sync.getSnapshot().items;
  assert.equal(items.length, 63); assert.equal(h.repository.getSnapshot().items.length, 50);
  assert.equal(items[0].id, local.id); assert.equal(items[0].photo.path, local.photo.path); assert.equal(items[0].input, 'typed');
  assert.equal(new Set(items.map(x => x.questionId)).size, 63);
  assert.deepEqual(requests.map(x => new URL(x.url).searchParams.get('cursor')), [null, '20', '40', '60']);
  assert.equal(requests[0].options.credentials, 'include'); assert.equal(requests[0].options.redirect, 'error');
  await h.repository.settled(); assert.equal(h.written().items.length, 50); h.dispose();
});

test('offline and incomplete server lists retain cache; demo-only empty account never shows fake answers', async () => {
  const cached = toEntry(row()), fresh = toEntry(row()); let offline = true, demo = false;
  const h = await setup({ page: async () => { if (offline) throw Error('offline'); return { entries: demo ? [] : [fresh], nextCursor: null, demo }; } }, [cached]);
  await h.sync.refresh(); assert.equal(h.sync.getSnapshot().error, 'load'); assert.equal(h.sync.getSnapshot().items[0].id, cached.id);
  offline = false; await h.sync.retry(); assert.deepEqual(new Set(h.sync.getSnapshot().items.map(x => x.id)), new Set([cached.id, fresh.id]));
  demo = true; await h.sync.refresh(); assert.equal(h.sync.getSnapshot().items.length, 0); assert.equal(h.repository.getSnapshot().items.length, 0); h.dispose();
});

test('an unexpectedly empty next page exposes a retry state and preserves cached answers', async () => {
  const entry = toEntry(row());
  const h = await setup({ page: async cursor => ({ entries: cursor ? [] : [entry], nextCursor: cursor ? null : 'next', demo: false }) }, [entry]);
  await h.sync.refresh(); await h.sync.more(); assert.equal(h.sync.getSnapshot().error, 'more');
  assert.equal(h.sync.getSnapshot().nextCursor, 'next'); assert.equal(h.repository.getSnapshot().items.length, 1); h.dispose();
});

test('page failure retries the same opaque cursor; a looping cursor stops without duplicating data', async () => {
  const entry = toEntry(row()); let fail = true; const seen = [];
  const h = await setup({ page: async cursor => {
    seen.push(cursor); if (!cursor) return { entries: [entry], nextCursor: 'opaque+/=', demo: false };
    if (fail) throw Error('offline'); return { entries: [entry], nextCursor: 'opaque+/=', demo: false };
  } });
  await h.sync.refresh(); await h.sync.more(); assert.equal(h.sync.getSnapshot().error, 'more');
  fail = false; await h.sync.retry(); assert.deepEqual(seen, [null, 'opaque+/=', 'opaque+/=']); assert.equal(h.sync.getSnapshot().error, 'more'); assert.equal(h.sync.getSnapshot().items.length, 1); h.dispose();
});

test('clear waits for server success, aborts a pending read, and rejects its late result', async () => {
  const entry = toEntry(row()), get = deferred(), del = deferred(); let readSignal, deletes = 0;
  const h = await setup({ page: (_, signal) => { readSignal = signal; return get.promise; }, clear: () => { deletes++; return del.promise; } }, [entry]);
  const refresh = h.sync.refresh(); await tick(); const clear = h.sync.clear();
  assert.equal(readSignal.aborted, true); assert.equal(h.repository.getSnapshot().items.length, 1);
  assert.equal(await h.sync.clear(), false); assert.equal(deletes, 1);
  get.resolve({ entries: [entry], nextCursor: null, demo: false }); await refresh;
  del.resolve(1); assert.equal(await clear, true); assert.equal(h.sync.getSnapshot().items.length, 0); assert.equal(h.repository.getSnapshot().items.length, 0); h.dispose();
});

test('uncertain deletion preserves cache, cancellation aborts, and account lock rejects late pages', async () => {
  const entry = toEntry(row()); let signal; const gate = deferred();
  const h = await setup({ page: (_, s) => { signal = s; return gate.promise; }, clear: async () => { throw Error('lost response'); } }, [entry]);
  assert.equal(await h.sync.clear(), false); assert.equal(h.sync.getSnapshot().error, 'clear'); assert.equal(h.repository.getSnapshot().items.length, 1);
  const pending = h.sync.refresh(); await tick(); h.lock(); assert.equal(signal.aborted, true);
  gate.resolve({ entries: [toEntry(row())], nextCursor: null, demo: false }); await pending;
  assert.equal(h.repository.getSnapshot().items[0].id, entry.id); h.dispose();
});

test('local removal has Undo and makes no server mutation; Refresh may bring the answer back', async () => {
  const entry = toEntry(row()), api = { page: async () => ({ entries: [entry], nextCursor: null, demo: false }), clear: () => assert.fail('No server delete on local removal') };
  const h = await setup(api, [entry]); await h.sync.refresh(); h.sync.removeLocal(entry);
  assert.equal(h.sync.getSnapshot().items.length, 0); assert.equal(h.repository.getSnapshot().undo.id, entry.id);
  h.sync.restoreLocal(); assert.equal(h.sync.getSnapshot().items.length, 1);
  h.sync.removeLocal(entry); await h.sync.refresh(); assert.equal(h.sync.getSnapshot().items.length, 1); h.dispose();
});

test('History API validates pages and delete responses, encodes cursors and locks expired authentication', async () => {
  let locked = 0;
  const unauthorized = createHistoryApi('https://test.example', async () => Response.json({}, { status: 401 }), () => locked++);
  await assert.rejects(unauthorized.page(null, new AbortController().signal), /not_authenticated/); assert.equal(locked, 1);
  const api = createHistoryApi('https://test.example', async (url, options) => {
    if (options.method === 'DELETE') { assert.equal(new URL(url).search, ''); return Response.json({ deleted: 3 }); }
    assert.equal(new URL(url).searchParams.get('cursor'), 'opaque+/='); return Response.json({ questions: [], next_cursor: null, demo: true });
  });
  assert.deepEqual(await api.page('opaque+/=', new AbortController().signal), { entries: [], nextCursor: null, demo: true });
  assert.equal(await api.clear(new AbortController().signal), 3);
  for (const body of [{ questions: [{}] }, { questions: [], next_cursor: {} }]) await assert.rejects(createHistoryApi('https://test.example', async () => Response.json(body)).page(null, new AbortController().signal), /history_invalid/);
  await assert.rejects(createHistoryApi('https://test.example', async () => Response.json({ deleted: 'all' })).clear(new AbortController().signal), /history_invalid/);
});
