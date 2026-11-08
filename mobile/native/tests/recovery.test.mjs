import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveringPublisher } from '../src/streaming/recovery.ts';
import { selectLanHost, mediaLanEnvironment } from '../scripts/lan-host.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('stream retries use fresh peers, cap repeated failures, and ignore callbacks from old peers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const callbacks = [], states = []; let stops = 0;
  const p = new RecoveringPublisher(state => { callbacks.push(state); return { start: async () => state('connecting'), stop: () => stops++ }; }, state => states.push(state));
  await p.start(); await p.start(); assert.equal(callbacks.length, 1);
  callbacks[0]('failed'); callbacks[0]('connected'); assert.equal(states.at(-1), 'reconnecting');
  for (const delay of [1000, 2500, 5000]) { t.mock.timers.tick(delay); await tick(); callbacks.at(-1)('failed'); }
  assert.equal(callbacks.length, 4); assert.equal(stops, 4); assert.equal(states.at(-1), 'failed');
  t.mock.timers.tick(60000); assert.equal(callbacks.length, 4); p.stop();
});

test('Stop cancels backoff and ignores a late connection; stable connection renews retry budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cb, count = 0; const states = [];
  const p = new RecoveringPublisher(state => { count++; cb = state; return { start: async () => {}, stop: () => {} }; }, state => states.push(state), [100], 500);
  await p.start(); cb('failed'); t.mock.timers.tick(100); await tick(); cb('connected'); t.mock.timers.tick(500); cb('failed');
  assert.equal(states.at(-1), 'reconnecting'); p.stop(); cb('connected'); t.mock.timers.tick(1000);
  assert.equal(count, 2); assert.equal(states.at(-1), 'reconnecting');
});

test('synchronous factory error and rejected start share one bounded retry schedule', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0; const states = [];
  const p = new RecoveringPublisher(state => {
    if (++calls === 1) throw Error('native creation failed');
    return { start: async () => { state('failed'); throw Error('POST failed'); }, stop: () => {} };
  }, state => states.push(state), [10]);
  await p.start(); t.mock.timers.tick(10); await tick(); assert.equal(calls, 2); assert.equal(states.at(-1), 'failed'); p.stop();
});

test('LAN selection prefers Wi-Fi, excludes virtual/link-local adapters and validates explicit overrides', () => {
  const ipv4 = address => [{ address, family: 'IPv4', internal: false }];
  const interfaces = { 'VMware VMnet8': ipv4('192.168.95.1'), 'vEthernet (WSL)': ipv4('172.23.80.1'), Ethernet: ipv4('169.254.1.3'), 'Wi-Fi': ipv4('192.168.1.103') };
  assert.equal(selectLanHost(interfaces).address, '192.168.1.103');
  assert.throws(() => selectLanHost(interfaces, '192.168.1.999')); assert.throws(() => selectLanHost(interfaces, '192.168.1.104'));
  assert.throws(() => selectLanHost({ 'VMware VMnet8': interfaces['VMware VMnet8'] }));
  assert.equal(selectLanHost(interfaces, '172.23.80.1').name, 'vEthernet (WSL)');
  const env = mediaLanEnvironment('192.168.1.103'); assert.equal(env.MTX_WEBRTCLOCALUDPADDRESS, '192.168.1.103:8189'); assert.equal(env.MTX_WEBRTCIPSFROMINTERFACES, 'no');
});
