/** Each Start owns its resources. Late completions must dispose into that lifetime. */
export class Lifetime {
  readonly controller = new AbortController();
  private cleanups: (() => void)[] = [];
  get active() { return !this.controller.signal.aborted; }
  own(cleanup: () => void) {
    if (this.active) this.cleanups.push(cleanup);
    else cleanup();
  }
  stop() {
    if (!this.active) return;
    this.controller.abort();
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Continue releasing other resources. */ }
    }
  }
}
