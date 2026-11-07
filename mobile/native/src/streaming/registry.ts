import { boundedFetch } from '../platform/config.ts';
export const validSessionId = (id: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
// web/ai-backend/app/streams.py: Start and Stop tell the backend which stream this account publishes,
// so the web dashboard's Connect finds it.
export class StreamRegistry {
  private queue = Promise.resolve();
  constructor(private origin: string, private fetcher: typeof fetch = fetch, private onUnauthorized = () => {}, private allowed = () => true) {}
  request(action: 'start' | 'stop', id: string) {
    if (!validSessionId(id)) return Promise.reject(Error('invalid_session_id'));
    // A rapid Stop must follow its Start, including when Start fails or times out.
    const result = this.queue.then(() => this.send(action, id));
    this.queue = result.catch(() => {});
    return result;
  }
  private async send(action: 'start' | 'stop', id: string) {
    if (action === 'start' && !this.allowed()) throw Error('auth_lost');
    const response = await boundedFetch(`${this.origin}/api/v1/streams/${action}`, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: id }) }, 5000, this.fetcher);
    if (response.status === 401) { this.onUnauthorized(); throw Error('auth_lost'); }
    if (!response.ok) throw Error('registry_failed');
    if (action === 'start') {
      const data = await response.json().catch(() => null);
      if (data?.session?.session_id !== id || !Number.isFinite(Date.parse(data?.session?.started_at))) throw Error('registry_failed');
    }
  }
}
