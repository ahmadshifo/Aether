// Battery and connection warnings: when they are said, and that they never talk over the user or an answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryWarning, connectionWarning, warningCopy } from '../src/voice/warnings.ts';
import { SessionController } from '../src/session/controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('battery: 20 % and 10 % are each said once, never while charging', () => {
  const spoken = new Set();
  assert.equal(batteryWarning(0.5, false, spoken), null);
  assert.equal(batteryWarning(0.2, false, spoken), 'battery20');
  assert.equal(batteryWarning(0.19, false, spoken), null);
  assert.equal(batteryWarning(0.1, true, spoken), null);  // plugged in
  assert.equal(batteryWarning(0.09, false, spoken), 'battery10');
  assert.equal(batteryWarning(0.05, false, spoken), null);
  assert.equal(batteryWarning(0.3, true, spoken), null);  // charged back up: the warnings can come again
  assert.equal(batteryWarning(0.2, false, spoken), 'battery20');
  assert.equal(batteryWarning(-1, false, new Set()), null);  // unknown level
  assert.equal(batteryWarning(0.05, false, new Set()), 'battery10');  // starting low: only the more urgent one
});

test('connection: lost after it worked, back again, and a link that never connected', () => {
  assert.equal(connectionWarning('connecting', 'connected', false, false), null);
  assert.equal(connectionWarning('connected', 'reconnecting', true, false), 'connectionLost');
  assert.equal(connectionWarning('reconnecting', 'failed', true, true), null);  // already said
  assert.equal(connectionWarning('failed', 'connected', true, true), 'connectionBack');
  assert.equal(connectionWarning('connecting', 'failed', false, false), 'connectionFailed');
  assert.equal(connectionWarning('connected', 'off', true, false), null);  // camera off on purpose
});

function harness() {
  const spoken = [], events = [];
  let battery, link;
  const ports = {
    preview: false, recognitionAvailable: true, streamingAvailable: true, uuid: () => crypto.randomUUID(), allowed: () => true,
    ask: async r => { await wait(300); return { question_id: r.question_id, language: r.language, answer: 'A door.', uncertain: false, evidence_frame_ids: [] }; },
    camera: async () => ({ release: () => {} }),
    recognition: async (_, callbacks) => { events.push(callbacks); callbacks.start(); return async () => {}; },
    speak: async (text, _, start) => { spoken.push(text); start(); return 'done'; }, stopSpeech: () => {},
    publish: (_, __, state) => { link = state; return { start: async () => { state('connected'); }, stop: () => {} }; },
    register: async () => {}, keepAwake: () => {}, answer: () => {},
    watchBattery: listener => { battery = listener; return () => { battery = undefined; }; },
  };
  const controller = new SessionController(ports);
  const listening = async () => { await settle(); await wait(600); await settle(); };
  return { controller, spoken, events, battery: (...args) => battery?.(...args), link: value => link(value), listening, stopped: () => !battery };
}

test('a low battery is said while the phone is listening, once', async () => {
  const h = harness();
  await h.controller.start('en'); await h.listening();
  h.battery(0.19, false); await h.listening();
  h.battery(0.18, false); await h.listening();
  assert.equal(h.spoken.filter(text => text === warningCopy.en.battery20).length, 1);
  h.controller.stop();
  assert.ok(h.stopped());  // stops watching the battery with the session
});

test('a warning waits until the answer has been spoken', async () => {
  const h = harness();
  await h.controller.start('en'); await h.listening();
  h.events.at(-1).result('What is in front of me', true);
  await wait(50);
  h.battery(0.1, false);  // arrives while the question is being answered
  await wait(400); await h.listening(); await h.listening();
  const answer = h.spoken.indexOf('A door.'), warning = h.spoken.indexOf(warningCopy.en.battery10);
  assert.ok(answer >= 0 && warning > answer, h.spoken.join(' | '));
  h.controller.stop();
});

test('losing the video link is said, and so is getting it back', async () => {
  const h = harness();
  await h.controller.start('ar'); await h.listening();
  h.link('reconnecting'); await h.listening();
  assert.equal(h.spoken.at(-1), warningCopy.ar.connectionLost);
  h.link('connected'); await h.listening();
  assert.equal(h.spoken.at(-1), warningCopy.ar.connectionBack);
  h.controller.stop();
});
