import test from 'node:test';
import assert from 'node:assert/strict';
import { WhipPublisher, resourceLocation } from '../src/streaming/whip.ts';
import { validateEndpoints, boundedFetch } from '../src/platform/config.ts';
import { StreamRegistry } from '../src/streaming/registry.ts';
import { preferH264 } from '../src/streaming/codecs.ts';
test('H.264 is preferred without claiming unsupported codecs; absent/throwing capabilities are safe', () => {
  const codecs = [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }, { mimeType: 'video/rtx' }];
  let chosen;
  preferH264(() => ({ codecs }), value => { chosen = value; });
  assert.equal(chosen[0].mimeType, 'video/H264'); assert.equal(chosen.length, 3);
  chosen = undefined;
  preferH264(undefined, () => assert.fail()); preferH264(() => null, undefined);
  preferH264(() => { throw Error('Unavailable'); }, () => assert.fail());
  preferH264(() => ({ codecs: [codecs[0]] }), () => assert.fail());
  assert.equal(chosen, undefined);
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function peer(ice = 'complete') {
  const listeners = new Map(); let closed = 0;
  return { iceGatheringState: ice, connectionState: 'new', localDescription: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n' },
    createOffer: async function () { return this.localDescription; }, setLocalDescription: async () => {}, setRemoteDescription: async () => {},
    close: () => closed++, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    change(name) { listeners.get(name)?.(); }, closed: () => closed, listeners,
  };
}
const answer = (location = '/resource/one') => new Response('v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n', { status: 201, headers: { 'Content-Type': 'application/sdp', Location: location } });

test('a brief disconnect recovers without closing; sustained loss closes once after grace', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pc = peer(), states = [], publisher = new WhipPublisher(pc, value => states.push(value), async (_, o) => o.method === 'POST' ? answer() : new Response(null, { status: 204 }), 12000, 4000);
  await publisher.start('https://media.example/live/id/whip');
  pc.connectionState = 'connected'; pc.change('connectionstatechange');
  pc.connectionState = 'disconnected'; pc.change('connectionstatechange'); assert.equal(states.at(-1), 'reconnecting');
  t.mock.timers.tick(3999); assert.equal(pc.closed(), 0);
  pc.connectionState = 'connected'; pc.change('connectionstatechange'); t.mock.timers.tick(4000); assert.equal(pc.closed(), 0);
  pc.connectionState = 'disconnected'; pc.change('connectionstatechange'); t.mock.timers.tick(4000);
  assert.equal(states.at(-1), 'failed'); assert.equal(pc.closed(), 1); publisher.stop(); assert.equal(pc.closed(), 1);
});
test('WHIP validates SDP/Location, video-only offer contract and actual connection state; Stop sends bounded DELETE', async () => {
  const pc = peer(), calls = [], states = [];
  const publisher = new WhipPublisher(pc, state => states.push(state), async (url, options) => { calls.push({ url, options }); return options.method === 'POST' ? answer() : new Response(null, { status: 204 }); }, 100);
  await publisher.start('http://192.168.1.2:8889/live/id/whip');
  assert.deepEqual(states, ['connecting']); // HTTP 201 alone is not connected.
  pc.connectionState = 'connected'; pc.change('connectionstatechange'); assert.equal(states.at(-1), 'connected');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/sdp'); assert.equal(calls[0].options.credentials, 'omit'); assert.match(calls[0].options.body, /sendonly/);
  publisher.stop(); await tick(); assert.equal(calls[1].url, 'http://192.168.1.2:8889/resource/one'); assert.equal(calls[1].options.method, 'DELETE'); assert.equal(pc.closed(), 1); assert.equal(pc.listeners.size, 0);
});
test('relative and same-origin absolute locations work; missing and foreign locations fail closed', () => {
  assert.equal(resourceLocation('resource/a', 'https://media.example/live/id/whip'), 'https://media.example/live/id/resource/a');
  assert.equal(resourceLocation('https://media.example/a', 'https://media.example/live/id/whip'), 'https://media.example/a');
  for (const value of [null, 'https://other.example/resource', 'https://user:password@media.example/resource']) assert.throws(() => resourceLocation(value, 'https://media.example/live/id/whip'));
});
test('ICE deadline, stopped gathering, invalid HTTP/SDP and late resource response all clean up', async () => {
  const pc = peer('gathering'), publisher = new WhipPublisher(pc, () => {}, fetch, 5);
  await assert.rejects(publisher.start('https://media.example/live/id/whip'), /ice_timeout/); assert.equal(pc.closed(), 1);
  const pendingPc = peer('gathering'), pending = new WhipPublisher(pendingPc, () => {}, fetch, 100);
  const attempt = pending.start('https://media.example/live/id/whip'); await tick(); pending.stop(); await attempt; assert.equal(pendingPc.listeners.size, 0);
  for (const response of [new Response('bad', { status: 500 }), new Response('not SDP', { status: 201, headers: { Location: '/resource', 'Content-Type': 'application/sdp' } })]) {
    const bad = peer(), p = new WhipPublisher(bad, () => {}, async (_, options) => options.method === 'POST' ? response : new Response(null, { status: 204 }), 20);
    await assert.rejects(p.start('https://media.example/live/id/whip')); assert.equal(bad.closed(), 1);
  }
  let resolve; const calls = [], latePc = peer(), late = new WhipPublisher(latePc, () => {}, async (_, options) => { calls.push(options.method); return options.method === 'POST' ? new Promise(done => { resolve = done; }) : new Response(null, { status: 204 }); });
  const start = late.start('https://media.example/live/id/whip'); await tick(); late.stop(); resolve(answer()); await start; await tick(); assert.deepEqual(calls, ['POST', 'DELETE']);
});
test('transport loss after HTTP success cannot remain connected', async () => {
  const pc = peer(), states = [], publisher = new WhipPublisher(pc, value => states.push(value), async (_, o) => o.method === 'POST' ? answer() : new Response(null, { status: 204 }));
  await publisher.start('https://media.example/live/id/whip'); pc.connectionState = 'failed'; pc.change('connectionstatechange'); assert.equal(states.at(-1), 'failed'); assert.equal(pc.closed(), 1);
});
test('connection validation rejects credential URLs, paths, public HTTP and foreign redirects; registry preserves body and origin', async () => {
  for (const url of ['http://public.example', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test/?x=1']) assert.throws(() => validateEndpoints({ backend: url, media: 'https://media.example', allowLan: true }));
  assert.equal(validateEndpoints({ backend: 'http://192.168.1.2:18063', media: 'http://192.168.1.2:8889', allowLan: true }).backend, 'http://192.168.1.2:18063');
  await assert.rejects(boundedFetch('https://fixture.example/health', {}, 10, async () => ({ redirected: true })), /redirect_rejected/);
  const calls = [], registry = new StreamRegistry('https://fixture.example', async (url, options) => { calls.push({ url, options }); return url.endsWith('/start') ? Response.json({ session: { session_id: JSON.parse(options.body).session_id, started_at: new Date().toISOString() } }) : new Response(null, { status: 204 }); });
  const id = crypto.randomUUID(); await registry.request('start', id); await registry.request('stop', id);
  assert.equal(calls[0].url, 'https://fixture.example/api/v1/streams/start'); assert.deepEqual(JSON.parse(calls[0].options.body), { session_id: id });
  await assert.rejects(registry.request('start', 'bad')); assert.equal(calls.length, 2);
});
