import { boundEntries, mergeHistory, type HistoryRepository } from './history.ts';
import type { createHistoryApi } from './serverHistory.ts';
import type { Entry } from '../shared/types.ts';

export type HistorySyncState = {
  items: Entry[]; status: 'idle' | 'refreshing' | 'more' | 'ready' | 'error' | 'clearing';
  nextCursor: string | null; error: 'load' | 'more' | 'clear' | null;
};
export class HistorySync {
  private state: HistorySyncState = { items: [], status: 'idle', nextCursor: null, error: null };
  private remote: Entry[] = [];
  private hidden = new Set<string>();
  private cursors = new Set<string>();
  private listeners = new Set<() => void>();
  private request?: AbortController;
  private generation = 0;
  private disposed = false;
  private unsubscribe: () => void;
  constructor(private repository: HistoryRepository, private api: ReturnType<typeof createHistoryApi>, private allowed: () => boolean) {
    this.unsubscribe = repository.subscribe(() => this.set({}));
    this.set({});
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private valid(g: number) { return !this.disposed && this.allowed() && g === this.generation; }
  private set(patch: Partial<HistorySyncState>) {
    if (this.disposed || !this.allowed()) return;
    const local = this.repository.getSnapshot().items;
    // Only the bounded repository owns photos; evicted files must not remain in the paged list.
    this.state = { ...this.state, ...patch, items: mergeHistory(this.remote, local).filter(entry => !this.hidden.has(entry.questionId)) };
    this.listeners.forEach(fn => fn());
  }
  refresh = () => this.load(false);
  more = () => this.load(true);
  retry = () => this.state.error === 'more' ? this.more() : this.refresh();
  private async load(more: boolean) {
    if (this.disposed || !this.allowed() || this.state.status === 'clearing' || more && (this.request || !this.state.nextCursor)) return;
    this.request?.abort();
    const request = new AbortController(), g = ++this.generation;
    this.request = request;
    const cursor = more ? this.state.nextCursor : null;
    if (!more) this.hidden.clear();
    this.set({ status: more ? 'more' : 'refreshing', error: null });
    try {
      await this.repository.ready;
      if (!this.valid(g)) return;
      const page = await this.api.page(cursor, request.signal);
      if (!this.valid(g)) return;
      if (page.nextCursor && (page.nextCursor === cursor || more && this.cursors.has(page.nextCursor))) throw Error('cursor_loop');
      // next_cursor promised another page. An empty response can indicate a broken
      // cursor (the current backend truncates milliseconds), so don't silently drop cache.
      if (more && !page.entries.length) throw Error('history_incomplete');
      if (!more) { this.remote = []; this.cursors.clear(); }
      if (cursor) this.cursors.add(cursor);
      this.remote = mergeHistory(page.entries, this.remote);
      // A partial/rounded cursor isn't proof that absent cached records were deleted.
      // Only a confirmed clear or the server's explicit empty-account response clears cache.
      if (!more && page.demo) this.repository.clear();
      else this.repository.merge(this.remote);
      this.set({ status: 'ready', nextCursor: page.nextCursor, error: null });
    } catch {
      if (this.valid(g)) this.set({ status: 'error', error: more ? 'more' : 'load' });
    } finally { if (this.request === request) this.request = undefined; }
  }
  async clear(): Promise<boolean> {
    if (this.disposed || !this.allowed() || this.state.status === 'clearing') return false;
    this.request?.abort();
    const request = new AbortController(), g = ++this.generation; this.request = request;
    this.set({ status: 'clearing', error: null });
    try {
      await this.api.clear(request.signal);
      if (!this.valid(g)) return false;
      this.remote = []; this.hidden.clear(); this.cursors.clear();
      this.repository.clear(); this.set({ status: 'ready', nextCursor: null });
      return true;
    } catch {
      // A lost DELETE response is uncertain. Keep the cache and let the user refresh or retry.
      if (this.valid(g)) this.set({ status: 'error', error: 'clear' });
      return false;
    } finally { if (this.request === request) this.request = undefined; }
  }
  removeLocal(entry: Entry) { this.hidden.add(entry.questionId); this.repository.remove(entry.id); this.set({}); }
  restoreLocal() { const entry = this.repository.getSnapshot().undo; if (entry) this.hidden.delete(entry.questionId); this.repository.restore(); this.set({}); }
  expire() { this.remote = boundEntries(this.remote, Date.now(), Number.MAX_SAFE_INTEGER); this.set({}); }
  cancel() {
    this.generation++; this.request?.abort(); this.request = undefined;
    this.set({ status: this.state.status === 'clearing' ? 'error' : 'idle', error: this.state.status === 'clearing' ? 'clear' : this.state.error });
  }
  dispose() { this.cancel(); this.disposed = true; this.unsubscribe(); this.listeners.clear(); this.remote = []; this.state = { items: [], status: 'idle', error: null, nextCursor: null }; }
}
