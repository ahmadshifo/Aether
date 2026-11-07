// Adapted from mobile/frontend/src/historyRepository.ts at bb54dbd.
// One metadata store; app-private files replace browser Blobs. No legacy import.
import type { Entry, Owner, Photo } from '../shared/types.ts';
export const RETENTION_MS = 86400000, MAX_PHOTO = 1500000, MAX_TOTAL = 20000000, MAX_ENTRIES = 50;
export type HistoryState = { items: Entry[]; loading: boolean; error: boolean; undo: Entry | null };
export interface StorageAdapter {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  collect(key: string, retained: string[]): Promise<void>;
}
const queues = new Map<string, Promise<void>>();
export const namespace = (owner: Pick<Owner, 'source' | 'userId'>) => {
  if (!owner.source || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(owner.userId)) throw Error('Verified owner required');
  return `aether-history-v1:${encodeURIComponent(owner.source)}:${owner.userId}`;
};
export function validPhoto(value: unknown): value is Photo {
  const p = value as Photo | null;
  return !!p && typeof p.path === 'string' && /^[a-f\d-]+\.jpg$/i.test(p.path) && Number.isFinite(p.bytes) && p.bytes > 0 && p.bytes <= MAX_PHOTO && Number.isFinite(Date.parse(p.capturedAt));
}
export function boundEntries(value: unknown, now = Date.now()): Entry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(); let bytes = 0;
  return value.filter((row): row is Entry => {
    if (!row || typeof row.id !== 'string' || seen.has(row.id) || typeof row.sessionId !== 'string' || typeof row.questionId !== 'string'
      || typeof row.question !== 'string' || row.question.length > 4000 || typeof row.answer !== 'string' || row.answer.length > 32000
      || !['en', 'ar'].includes(row.language) || !['speech', 'typed'].includes(row.input) || row.provenance !== 'server'
      || typeof row.uncertain !== 'boolean' || !Array.isArray(row.evidenceFrameIds) || row.evidenceFrameIds.length > 100 || !row.evidenceFrameIds.every((id: unknown) => typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
      || !Number.isFinite(Date.parse(row.createdAt)) || now - Date.parse(row.createdAt) >= RETENTION_MS || Date.parse(row.createdAt) > now + 60000) return false;
    seen.add(row.id); return true;
  }).slice(0, MAX_ENTRIES).map(row => {
    const photo = validPhoto(row.photo) && bytes + row.photo.bytes <= MAX_TOTAL ? row.photo : undefined;
    if (photo) bytes += photo.bytes;
    // Explicit fields exclude unknown payloads/credentials/prototypes.
    return { id: row.id, sessionId: row.sessionId, questionId: row.questionId, question: row.question, answer: row.answer,
      language: row.language, createdAt: row.createdAt, provenance: 'server', input: row.input, ...(photo ? { photo } : {}),
      uncertain: row.uncertain, evidenceFrameIds: [...new Set(row.evidenceFrameIds)] };
  });
}
export class HistoryRepository {
  readonly key: string;
  readonly ready: Promise<void>;
  private state: HistoryState = { items: [], loading: true, error: false, undo: null };
  private listeners = new Set<() => void>();
  private journal: ((items: Entry[]) => Entry[])[] = [];
  private disposed = false;
  private revision = 0;
  private undoPosition?: { index: number; before?: string; after?: string };
  private queue = Promise.resolve();
  private storage: StorageAdapter;
  constructor(readonly owner: Owner, storage: StorageAdapter, private allowed: () => boolean) {
    if (!allowed()) throw Error('Identity locked');
    this.key = namespace(owner); this.storage = storage;
    this.ready = this.hydrate();
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(partial: Partial<HistoryState>) { if (this.disposed) return; this.state = { ...this.state, ...partial }; this.listeners.forEach(fn => fn()); }
  private async hydrate() {
    let items: Entry[] = [], error = false;
    try {
      await queues.get(this.key);
      if (this.disposed || !this.allowed()) return;
      const raw = await this.storage.read(this.key);
      if (raw) { const data = JSON.parse(raw); if (!data || !Array.isArray(data.items) || !Number.isFinite(data.revision)) throw Error('Corrupt metadata'); items = boundEntries(data.items); this.revision = data.revision; }
    } catch { error = true; }
    if (this.disposed || !this.allowed()) return;
    this.journal.forEach(op => { items = op(items); }); this.journal = [];
    this.publish({ items: boundEntries(items), loading: false, error });
    // Corrupt/unreadable stores are never overwritten automatically.
    if (!error) this.persist();
  }
  private persist() {
    const snapshot = { revision: ++this.revision, items: this.state.items };
    const keep = [...snapshot.items, ...(this.state.undo ? [this.state.undo] : [])].flatMap(x => x.photo ? [x.photo.path] : []);
    this.queue = (queues.get(this.key) ?? Promise.resolve()).then(async () => {
      try {
        await this.storage.write(this.key, JSON.stringify(snapshot));
        await this.storage.collect(this.key, keep);
      } catch { this.publish({ error: true }); }
    });
    queues.set(this.key, this.queue);
    const last = this.queue; void last.then(() => { if (queues.get(this.key) === last) queues.delete(this.key); });
  }
  private mutate(op: (items: Entry[]) => Entry[]) {
    if (this.disposed || !this.allowed()) return;
    if (this.state.loading) this.journal.push(op);
    this.publish({ items: boundEntries(op(this.state.items)) });
    if (!this.state.loading) this.persist();
  }
  upsert(entry: Entry) { this.mutate(items => [entry, ...items.filter(x => x.id !== entry.id)]); }
  remove(id: string) {
    if (!this.allowed() || this.disposed || this.state.loading) return;
    const index = this.state.items.findIndex(x => x.id === id); if (index < 0) return;
    this.undoPosition = { index, before: this.state.items[index + 1]?.id, after: this.state.items[index - 1]?.id };
    this.publish({ undo: this.state.items[index] });
    this.mutate(items => items.filter(x => x.id !== id));
  }
  restore() {
    if (!this.allowed() || this.disposed) return;
    const item = this.state.undo, position = this.undoPosition;
    this.publish({ undo: null }); this.undoPosition = undefined;
    if (!item || !position) return;
    this.mutate(items => {
      const next = items.filter(x => x.id !== item.id);
      const before = next.findIndex(x => x.id === position.before), after = next.findIndex(x => x.id === position.after);
      next.splice(before >= 0 ? before : after >= 0 ? after + 1 : Math.min(position.index, next.length), 0, item); return next;
    });
  }
  dismissUndo() { if (!this.allowed() || this.disposed) return; this.publish({ undo: null }); this.undoPosition = undefined; if (!this.state.loading) this.persist(); }
  clear() { if (!this.allowed() || this.disposed) return; this.publish({ undo: null }); this.undoPosition = undefined; this.mutate(() => []); }
  expire() {
    if (!this.allowed() || this.disposed) return;
    if (this.state.undo && !boundEntries([this.state.undo]).length) this.dismissUndo();
    if (boundEntries(this.state.items).length !== this.state.items.length) this.mutate(items => items);
  }
  async settled() { await this.ready; await this.queue; }
  dispose() { this.disposed = true; this.listeners.clear(); this.journal = []; this.state = { items: [], loading: false, error: false, undo: null }; }
}
export function dateGroup(item: Entry, now = new Date()): 'today' | 'yesterday' | 'earlier' {
  const date = new Date(item.createdAt), yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return same(date, now) ? 'today' : same(date, yesterday) ? 'yesterday' : 'earlier';
}
export function searchHistory(items: Entry[], query: string) {
  const normalize = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
  return items.filter(row => normalize(`${row.question} ${row.answer}`).includes(normalize(query)));
}
