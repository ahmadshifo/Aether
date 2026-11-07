// Native protocol adaptation of mobile/frontend/src/whipPublisher.ts at bb54dbd.
export type Transport = 'off' | 'connecting' | 'connected' | 'failed';
type Description = { type: 'offer' | 'answer'; sdp?: string };
export interface Peer {
  iceGatheringState: string; connectionState: string; localDescription: Description | null;
  createOffer(): Promise<Description>; setLocalDescription(value: Description): Promise<void>;
  setRemoteDescription(value: Description): Promise<void>; close(): void;
  addEventListener(name: string, fn: () => void): void; removeEventListener(name: string, fn: () => void): void;
}
export function resourceLocation(location: string | null, endpoint: string) {
  if (!location) throw Error('whip_location');
  const url = new URL(location, endpoint);
  if (url.origin !== new URL(endpoint).origin || url.username || url.password || url.hash) throw Error('whip_location');
  return url.href;
}
export class WhipPublisher {
  private stopped = false;
  private resource?: string;
  private abort = new AbortController();
  private listeners: (() => void)[] = [];
  private transportTimer?: ReturnType<typeof setTimeout>;
  constructor(private pc: Peer, private state: (value: Transport) => void, private fetcher: typeof fetch = fetch, private timeout = 12000) {}
  async start(endpoint: string) {
    if (this.stopped) return;
    this.state('connecting');
    const onConnection = () => {
      if (this.stopped) return;
      if (this.pc.connectionState === 'connected') { clearTimeout(this.transportTimer); this.state('connected'); }
      else if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) { this.state('failed'); this.stop(); }
    };
    this.pc.addEventListener('connectionstatechange', onConnection);
    this.listeners.push(() => this.pc.removeEventListener('connectionstatechange', onConnection));
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      if (this.stopped) return;
      await this.waitForIce();
      if (this.stopped) return;
      const sdp = this.pc.localDescription?.sdp;
      if (!sdp?.startsWith('v=0')) throw Error('whip_sdp');
      const timer = setTimeout(() => this.abort.abort(), this.timeout);
      try {
        const response = await this.fetcher(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' }, body: sdp, signal: this.abort.signal, credentials: 'omit', redirect: 'error' });
        if (response.redirected || response.status !== 201) throw Error(`whip_response_${response.status}`);
        this.resource = resourceLocation(response.headers.get('Location'), endpoint);
        // An aborted native POST can still return a created resource. Always delete it.
        if (this.stopped) { this.deleteResource(); return; }
        const answer = await response.text();
        if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/sdp') || !answer.startsWith('v=0') || !/m=video\s/.test(answer)) throw Error('whip_sdp');
        if (this.stopped) return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answer });
        if (this.stopped) return;
        onConnection();
        if (this.pc.connectionState !== 'connected') this.transportTimer = setTimeout(() => { this.state('failed'); this.stop(); }, this.timeout);
      } finally { clearTimeout(timer); }
    } catch (error) { if (!this.stopped) { this.state('failed'); this.stop(); throw error; } }
  }
  stop() {
    this.stopped = true; this.abort.abort(); clearTimeout(this.transportTimer);
    this.listeners.splice(0).forEach(fn => fn()); this.pc.close(); this.deleteResource();
  }
  private deleteResource() {
    const resource = this.resource; this.resource = undefined; if (!resource) return;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 3000);
    void this.fetcher(resource, { method: 'DELETE', signal: abort.signal, credentials: 'omit', redirect: 'error' }).catch(() => {}).finally(() => clearTimeout(timer));
  }
  private waitForIce() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); this.pc.removeEventListener('icegatheringstatechange', changed); this.abort.signal.removeEventListener('abort', aborted); if (error) reject(error); else resolve(); };
      const changed = () => { if (this.pc.iceGatheringState === 'complete') finish(); };
      const aborted = () => finish(Error('cancelled'));
      const timer = setTimeout(() => finish(Error('ice_timeout')), this.timeout);
      this.pc.addEventListener('icegatheringstatechange', changed); this.abort.signal.addEventListener('abort', aborted, { once: true });
      if (this.abort.signal.aborted) aborted(); else changed();
    });
  }
}
