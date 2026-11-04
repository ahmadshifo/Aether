import { boundedFetch } from '../platform/config.ts';
export const validSessionId = (id: string) => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
// web/ai-backend/app/streams.py: Start and Stop tell the backend which stream this account publishes,
// so the web dashboard's Connect finds it.
export class StreamRegistry {
  constructor(private origin: string, private fetcher: typeof fetch = fetch) {}
  async request(action: 'start' | 'stop', id: string) {
    if (!validSessionId(id)) throw Error('invalid_session_id');
    const response = await boundedFetch(`${this.origin}/api/v1/streams/${action}`, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: id }) }, 5000, this.fetcher);
    if (!response.ok) throw Error(response.status === 401 ? 'auth_lost' : 'registry_failed');
  }
}
