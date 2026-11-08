import type { Transport } from './whip.ts';
type Publisher = { start(): Promise<void>; stop(): void };
// Every retry owns a fresh peer connection, but keeps the session id and camera track.
// Stop cancels retries; neither backgrounding nor a late POST can reopen a session.
export class RecoveringPublisher implements Publisher {
  private child?: Publisher;
  private started = false;
  private stopped = false;
  private generation = 0;
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stable?: ReturnType<typeof setTimeout>;
  constructor(private create: (state: (value: Transport) => void) => Publisher, private state: (value: Transport) => void,
    private delays = [1000, 2500, 5000], private stableMs = 30000) {}
  async start() { if (this.started || this.stopped) return; this.started = true; await this.attempt(); }
  private async attempt() {
    if (this.stopped) return;
    const g = ++this.generation;
    let failed = false;
    const valid = () => !this.stopped && g === this.generation;
    const failure = () => {
      if (!valid() || failed) return;
      failed = true; clearTimeout(this.stable); this.stable = undefined;
      try { this.child?.stop(); } catch { /* A closed native peer must not block retry. */ } this.child = undefined;
      if (this.retries >= this.delays.length) { this.state('failed'); return; }
      const delay = this.delays[this.retries++]; this.state('reconnecting');
      this.timer = setTimeout(() => { this.timer = undefined; if (valid()) void this.attempt(); }, delay);
    };
    try {
      this.child = this.create(value => {
        if (!valid() || failed) return;
        if (value === 'failed') { failure(); return; }
        if (value === 'connected') {
          this.stable ??= setTimeout(() => { if (valid() && !failed) this.retries = 0; this.stable = undefined; }, this.stableMs);
        } else { clearTimeout(this.stable); this.stable = undefined; }
        this.state(value === 'connecting' && this.retries > 0 ? 'reconnecting' : value);
      });
      await this.child.start();
    } catch { failure(); }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.generation++; clearTimeout(this.timer); clearTimeout(this.stable);
    try { this.child?.stop(); } catch { /* Stop still retires this generation. */ } this.child = undefined;
  }
}
