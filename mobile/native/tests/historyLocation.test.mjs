import test from 'node:test';
import assert from 'node:assert/strict';
import { areaLabel, parseHistoryLocation } from '../src/storage/historyLocation.ts';
import { boundEntries, mergeHistory, searchHistory, HistoryRepository } from '../src/storage/history.ts';
import { toEntry } from '../src/storage/serverHistory.ts';
import { HistorySync } from '../src/storage/historySync.ts';
const stamp = new Date().toISOString();
const place = label => ({ label, captured_at: stamp });
const row = label => ({ question_id: crypto.randomUUID(), session_id: crypto.randomUUID(), asked_at: stamp, question: 'What is here?', answer: 'A door', language: 'en', uncertain: false, evidence_frame_ids: [], location: place(label) });

test('area labels use city and district, deduplicate and never include streets', () => {
  assert.equal(areaLabel({ city: 'Beirut', district: 'Chiyah', street: 'Private street', name: 'Home' }), 'Beirut, Chiyah');
  assert.equal(areaLabel({ city: 'Beirut', district: 'beirut' }), 'Beirut');
  assert.equal(areaLabel({ region: 'Mount Lebanon', subregion: 'Baabda' }), 'Mount Lebanon, Baabda');
  assert.equal(areaLabel({ city: 'بيروت', district: 'الشياح' }), 'بيروت, الشياح');
  assert.equal(areaLabel({ country: 'France', city: 'Paris', district: 'Montmartre' }), 'Paris, Montmartre');
  assert.equal(areaLabel({ street: 'Unknown road' }), '');
});

test('metadata is bounded and strips raw coordinates from cache and API responses', () => {
  assert.deepEqual(parseHistoryLocation({ ...place(' Beirut '), latitude: 33, longitude: 35 }), place('Beirut'));
  for (const value of [null, {}, place(''), place('x'.repeat(161)), place('A\nB'), { label: 'Beirut', captured_at: '2026-01-01T00:00:00' }]) assert.equal(parseHistoryLocation(value), undefined);
  const entry = toEntry(row('Beirut, Chiyah'));
  assert.deepEqual(boundEntries([{ ...entry, location: { ...entry.location, latitude: 33 } }])[0].location, entry.location);
  assert.equal(toEntry({ ...row('x'), location: { label: {}, captured_at: stamp } }).location, undefined);
});

test('fresh install restores separate saved places; local remove/undo/refresh retains them', async () => {
  const rows = [toEntry(row('Beirut, Chiyah')), toEntry(row('Beirut, Baabda'))]; let stored;
  const repository = new HistoryRepository({ source: 'https://test.example', userId: crypto.randomUUID(), epoch: 1 }, { read: async () => null, write: async (_, data) => { stored = JSON.parse(data); }, collect: async () => {} }, () => true);
  await repository.ready;
  const sync = new HistorySync(repository, { page: async () => ({ entries: rows, nextCursor: null, demo: false }) }, () => true);
  await sync.refresh(); await repository.settled();
  assert.deepEqual(new Set(stored.items.map(x => x.location.label)), new Set(['Beirut, Chiyah', 'Beirut, Baabda']));
  assert.equal(searchHistory(sync.getSnapshot().items, 'chiyah').length, 1);
  sync.removeLocal(rows[0]); sync.restoreLocal(); assert.equal(repository.getSnapshot().items.find(x => x.id === rows[0].id).location.label, 'Beirut, Chiyah');
  sync.removeLocal(rows[0]); await sync.refresh(); assert.equal(sync.getSnapshot().items.find(x => x.id === rows[0].id).location.label, 'Beirut, Chiyah');
  sync.dispose(); repository.dispose();
});

test('old server records never inherit a newer cached place', () => {
  const local = toEntry(row('Beirut, Baabda')), remote = { ...local, location: undefined };
  assert.equal(mergeHistory([remote], [local])[0].location, undefined);
});
