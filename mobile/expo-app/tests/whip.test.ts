import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MediaStream, RTCPeerConnection } from 'react-native-webrtc';
import { WhipPublisher } from '../src/streaming/WhipPublisher';
class FakePeer {
  iceGatheringState = 'complete'; connectionState = 'new'; iceConnectionState = 'new';
  localDescription = { type: 'offer', sdp: 'v=0\r\nmock-offer' }; closed = 0;
  listeners = new Map<string, Set<() => void>>();
  addTransceiver(_track: unknown, init: { direction: string }) { assert.equal(init.direction, 'sendonly'); }
  addEventListener(event: string, listener: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  removeEventListener(event: string, listener: () => void) { this.listeners.get(event)?.delete(listener); }
  emit(event: string) { this.listeners.get(event)?.forEach(fn => fn()); }
  async createOffer() { return this.localDescription; }
  async setLocalDescription() {}
  async setRemoteDescription(answer: { sdp: string }) { assert.ok(answer.sdp.startsWith('v=0')); }
  close() { this.closed++; }
}
const stream = { getVideoTracks: () => [{}], getAudioTracks: () => [] } as unknown as MediaStream;
function setup(request: typeof fetch) {
  const peer = new FakePeer(); const status: string[] = [];
  const publisher = new WhipPublisher({ createPeer: () => peer as unknown as RTCPeerConnection, preferH264: () => true }, request, value => status.push(value));
  return { peer, status, publisher };
}
test('WHIP POST, relative Location, real connection event and one DELETE on Stop', async () => {
  const calls: { url: string; method?: string }[] = [];
  const { peer, status, publisher } = setup((async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    if (init?.method === 'POST') {
      assert.equal((init.headers as Record<string,string>)['Content-Type'], 'application/sdp');
      return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/resource/one' } });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  await publisher.start(stream, 'https://media.example/live/uuid/whip');
  assert.deepEqual(status, ['connecting']);
  peer.connectionState = 'connected'; peer.emit('connectionstatechange');
  assert.deepEqual(status, ['connecting', 'connected']);
  publisher.stop(); publisher.stop(); await Promise.resolve();
  assert.equal(peer.closed, 1); assert.deepEqual(calls[1], { url: 'https://media.example/resource/one', method: 'DELETE' });
});
test('Stop while gathering removes listeners and closes peer without POST', async () => {
  let posts = 0;
  const { peer, publisher } = setup((async () => { posts++; return new Response(); }) as typeof fetch);
  peer.iceGatheringState = 'gathering';
  const pending = publisher.start(stream, 'https://media.example/live/id/whip');
  await new Promise(resolve => setTimeout(resolve, 0)); publisher.stop(); await pending;
  assert.equal(posts, 0); assert.equal(peer.closed, 1); assert.equal(peer.listeners.get('icegatheringstatechange')?.size, 0);
});
test('late POST resource is deleted even when response ignores abort', async () => {
  let respond!: (response: Response) => void; let deletes = 0;
  const response = new Promise<Response>(resolve => { respond = resolve; });
  const { publisher } = setup((async (_url, init) => {
    if (init?.method === 'POST') return response;
    deletes++; return new Response(null, { status: 204 });
  }) as typeof fetch);
  const pending = publisher.start(stream, 'https://media.example/live/id/whip');
  await new Promise(resolve => setTimeout(resolve, 0)); publisher.stop();
  respond(new Response('v=0\r\nanswer', { status: 201, headers: { Location: 'resource' } }));
  await pending; assert.equal(deletes, 1);
});
test('bad HTTP status and audio tracks are rejected without false connected state', async () => {
  const { publisher, peer, status } = setup((async () => new Response('', { status: 403 })) as typeof fetch);
  await assert.rejects(publisher.start(stream, 'https://media.example/live/id/whip'), /403/);
  assert.equal(peer.closed, 1); assert.equal(status.includes('connected'), false);
  await assert.rejects(publisher.start(stream, 'https://media.example/live/id/whip'), /reused/);
  const other = setup(fetch).publisher;
  await assert.rejects(other.start({ ...stream, getAudioTracks: () => [{}] } as unknown as MediaStream, 'https://media.example'), /video only/);
});
