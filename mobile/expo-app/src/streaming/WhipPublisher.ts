import type { MediaStream, RTCPeerConnection } from 'react-native-webrtc';
export type StreamStatus = 'connecting' | 'connected' | 'off';
type Peer = RTCPeerConnection;
export type RtcFactory = {
  createPeer(): Peer;
  preferH264(peer: Peer): boolean;
};
/** Non-trickle WHIP. Owns peer and HTTP resource; caller owns camera tracks. */
export class WhipPublisher {
  private peer: Peer | null = null;
  private resource: string | null = null;
  private readonly abort = new AbortController();
  private stopped = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private factory: RtcFactory, private request: typeof fetch = fetch,
    private status: (value: StreamStatus) => void = () => {},
    private failure: (error: Error) => void = () => {}) {}

  async start(stream: MediaStream, endpoint: string) {
    if (this.stopped || this.peer) throw new Error('Publisher cannot be reused');
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('WHIP requires HTTP(S)');
    const track = stream.getVideoTracks()[0];
    if (!track || stream.getAudioTracks().length) throw new Error('WHIP requires video only');
    const peer = this.factory.createPeer();
    this.peer = peer;
    const fail = (message: string) => {
      if (this.stopped) return;
      this.stop();
      this.failure(new Error(message));
    };
    peer.addEventListener('connectionstatechange', () => {
      if (this.stopped) return;
      if (peer.connectionState === 'connected') {
        clearTimeout(this.disconnectTimer); clearTimeout(this.connectTimer);
        this.status('connected');
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') fail('WebRTC connection failed');
      else if (peer.connectionState === 'disconnected') {
        this.status('connecting');
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => fail('WebRTC disconnected; restart the session'), 8000);
      }
    });
    peer.addEventListener('iceconnectionstatechange', () => {
      if (peer.iceConnectionState === 'failed') fail('ICE failed: check the reachable UDP media path');
    });
    this.status('connecting');
    this.connectTimer = setTimeout(() => fail('WebRTC connection timed out; check signaling and UDP 8189'), 30000);
    try {
      peer.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      this.factory.preferH264(peer);
      await peer.setLocalDescription(await peer.createOffer());
      this.assertActive();
      await this.waitForIce(peer);
      this.assertActive();
      const response = await this.request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
        body: peer.localDescription?.sdp ?? '', signal: this.abort.signal,
      });
      if (response.status !== 201) throw new Error(`WHIP returned HTTP ${response.status}`);
      const location = response.headers.get('Location');
      if (!location) throw new Error('WHIP 201 missing Location; server cleanup cannot be guaranteed');
      const resource = new URL(location, endpoint);
      // Never send cleanup requests to an unrelated host from an untrusted header.
      if (resource.origin !== url.origin) throw new Error('WHIP Location must have the signaling origin');
      this.resource = resource.toString();
      // A mock/server may finish POST despite cancellation. Delete that late resource too.
      if (this.stopped) { this.deleteResource(); return; }
      const answer = await response.text();
      this.assertActive();
      if (!answer.startsWith('v=0')) throw new Error('WHIP returned invalid SDP');
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
      this.assertActive();
      // Connected is emitted exclusively by the native connection-state event.
    } catch (error) {
      const cancelled = this.stopped;
      this.stop();
      if (!cancelled) throw error;
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    clearTimeout(this.disconnectTimer); clearTimeout(this.connectTimer);
    this.peer?.close(); this.peer = null;
    this.deleteResource(); this.status('off');
  }
  private deleteResource() {
    const resource = this.resource; this.resource = null;
    if (!resource) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void this.request(resource, { method: 'DELETE', signal: controller.signal })
      .catch(() => {}).finally(() => clearTimeout(timeout));
  }
  private assertActive() { if (this.stopped) throw new Error('Publish cancelled'); }
  private waitForIce(peer: Peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>;
      const done = (error?: Error) => {
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', onChange);
        this.abort.signal.removeEventListener('abort', onAbort);
        error ? reject(error) : resolve();
      };
      const onChange = () => { if (peer.iceGatheringState === 'complete') done(); };
      const onAbort = () => done(new Error('Publish cancelled'));
      peer.addEventListener('icegatheringstatechange', onChange);
      this.abort.signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => done(new Error('ICE gathering timed out')), 12000);
      if (this.stopped) onAbort(); else onChange();
    });
  }
}
