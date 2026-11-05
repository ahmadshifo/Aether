import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/session/controller.ts';
import { demoAnswer, validTranscript } from '../src/voice/demo.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(overrides = {}) {
  const events = [], answers = [], counts = { capture: 0, release: 0, close: 0, start: 0, stop: 0, voiceStop: 0, speak: 0, wake: false }, snapshots = [];
  let allowed = true;
  const ports = { preview: false, recognitionAvailable: true, streamingAvailable: true, uuid: () => crypto.randomUUID(), allowed: () => allowed,
    camera: async () => { counts.capture++; return { release: () => counts.release++, snapshot: async () => snapshots.shift() }; },
    recognition: async (_, callbacks) => { events.push(callbacks); callbacks.start(); return async () => { counts.voiceStop++; }; },
    speak: async (_, __, start) => { counts.speak++; start(); return 'done'; }, stopSpeech: () => {},
    publish: (_, id, state) => ({ start: async () => { counts.start++; state('connected'); }, stop: () => counts.close++ }),
    register: async action => { counts[action]++; }, keepAwake: active => { counts.wake = active; },
    answer: entry => answers.push(entry), ...overrides,
  };
  const controller = new SessionController(ports);
  return { controller, ports, events, answers, counts, snapshots, lock: () => { allowed = false; controller.stop(); } };
}
test('Start is single-owner across 20 lifetimes; every Stop releases camera, peer, recognition and wake lock', async () => {
  const h = harness(), ids = new Set();
  for (let i = 0; i < 20; i++) {
    await Promise.all([h.controller.start('en'), h.controller.start('en')]);
    ids.add(h.controller.getSnapshot().id); assert.equal(h.controller.getSnapshot().phase, 'listening');
    h.controller.stop(); await tick(); assert.equal(h.counts.wake, false); assert.equal(h.controller.getSnapshot().active, false);
  }
  assert.equal(ids.size, 20); assert.equal(h.counts.capture, 20); assert.equal(h.counts.release, 20); assert.equal(h.counts.close, 20); assert.equal(h.counts.voiceStop, 20);
});
test('Stop/logout during permission or camera startup rejects late acquired tracks and callbacks', async () => {
  for (const logout of [false, true]) {
    const gate = deferred(); let released = 0;
    const h = harness({ camera: () => gate.promise });
    const start = h.controller.start('en'); await tick(); if (logout) h.lock(); else h.controller.stop();
    gate.resolve({ release: () => released++ }); await start; h.events[0].result('Read the sign', true); await tick();
    assert.equal(released, 1); assert.equal(h.answers.length, 0); assert.equal(h.controller.getSnapshot().camera, false);
  }
});
test('only valid final speech produces a labeled demo and real speech adapter call; selected/interim text does not', async () => {
  const h = harness(); await h.controller.start('en');
  h.events[0].result('Read the sign', false); await tick(); assert.equal(h.answers.length, 0);
  h.events[0].result('Read the sign', true, .1); await tick(); assert.equal(h.answers.length, 0);
  h.events[0].result('Read the sign', true, .9); await tick(); await tick();
  assert.equal(h.answers.length, 1); assert.equal(h.answers[0].answer, 'The sign on the door reads Room 205.');
  assert.equal(h.answers[0].demo, true); assert.equal(h.answers[0].input, 'speech'); assert.equal(h.counts.speak, 1);
  h.events[0].result('Read the sign', true); await tick(); assert.equal(h.answers.length, 1); h.controller.stop();
});
test('interruption/language change while frame resolves cannot save a stale question or photo', async () => {
  for (const action of ['stop', 'pause', 'changeLanguage']) {
    const frame = deferred(), saved = [];
    const h = harness({ camera: async () => ({ release() {}, snapshot: () => frame.promise }), savePhoto: async image => { saved.push(image); return { path: 'a.jpg', bytes: 10, capturedAt: image.capturedAt }; } });
    await h.controller.start('en'); h.events[0].result('Read the sign', true); await tick();
    h.controller[action]('ar'); frame.resolve({ uri: 'synthetic-test-file', capturedAt: new Date().toISOString() }); await tick(); await tick();
    assert.equal(h.answers.length, 0); assert.equal(saved.length, 0); h.controller.stop();
  }
});
test('Expo Go typed demo is explicit, uses one preview, does not recognize or publish, and camera absence is truthful', async () => {
  const h = harness({ preview: true, recognitionAvailable: false, streamingAvailable: false });
  await h.controller.start('ar'); assert.equal(h.controller.getSnapshot().phase, 'unavailable');
  await h.controller.typedQuestion('اقرأ اللافتة'); assert.equal(h.answers[0].input, 'typed'); assert.equal(h.answers[0].answer, 'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.');
  assert.equal(h.events.length, 0); assert.equal(h.counts.start, 0); h.controller.stop();
  assert.match(demoAnswer('Read the sign', 'en', false), /camera is off/);
  assert.equal(validTranscript('cough'), false);
});
test('idle mixed-language Replay cannot acquire camera/microphone; old speech callbacks cannot resurrect activity', async () => {
  const gate = deferred(); let spokenLanguage;
  const h = harness({ speak: async (_, language, start) => { spokenLanguage = language; start(); return gate.promise; } });
  const replay = h.controller.replay({ answer: 'مثال تجريبي', language: 'ar' }); await tick();
  assert.equal(spokenLanguage, 'ar'); assert.equal(h.counts.capture, 0); assert.equal(h.events.length, 0);
  h.controller.stop(); gate.resolve('done'); await replay; assert.equal(h.controller.getSnapshot().active, false); assert.equal(h.controller.getSnapshot().phase, 'idle');
});
test('recognition denial stops an in-flight camera; background never auto-restarts media', async () => {
  const gate = deferred(); let released = false;
  const h = harness({ camera: () => gate.promise }); const start = h.controller.start('en'); await tick();
  h.events[0].error('not-allowed'); gate.resolve({ release: () => { released = true; } }); await start;
  assert.equal(released, true); assert.equal(h.controller.getSnapshot().active, false);
  const next = harness(); await next.controller.start('en'); next.controller.stop(true); next.controller.resume(); await tick();
  assert.equal(next.counts.capture, 1); assert.equal(next.controller.getSnapshot().active, false);
});

test('a final event during recognizer startup waits for input shutdown before TTS', async () => {
  const gate = deferred(); let stopped = false;
  const h = harness({ recognition: async (_, events) => { events.start(); events.result('Read the sign', true); await gate.promise; return async () => { stopped = true; }; },
    speak: async () => { assert.equal(stopped, true); return 'done'; } });
  const start = h.controller.start('en'); await tick(); assert.equal(h.answers.length, 0);
  gate.resolve(); await start; await tick(); assert.equal(h.answers.length, 1); h.controller.stop();
});

test('Stop while photo save resolves discards the retired frame and never emits an answer', async () => {
  const gate = deferred(); let discarded;
  const h = harness({ savePhoto: () => gate.promise, discardPhoto: photo => { discarded = photo; } });
  h.snapshots.push({ uri: 'synthetic', capturedAt: new Date().toISOString() });
  await h.controller.start('en'); h.events[0].result('Read the sign', true); await tick(); h.controller.stop();
  const photo = { path: 'a.jpg', bytes: 8, capturedAt: new Date().toISOString() }; gate.resolve(photo); await tick();
  assert.equal(h.answers.length, 0); assert.equal(discarded, photo);
});
test('silence keeps listening however long it lasts; real recognition failures still give up', async () => {
  const h = harness();
  await h.controller.start('ar');
  for (let i = 0; i < 6; i++) {
    h.events.at(-1).error('no-speech'); h.events.at(-1).end();
    await new Promise(resolve => setTimeout(resolve, 450)); await tick();
    assert.equal(h.events.length, i + 2); assert.equal(h.controller.getSnapshot().phase, 'listening');
  }
  for (let i = 0; i < 4; i++) {
    h.events.at(-1).error('network');
    await new Promise(resolve => setTimeout(resolve, 400 * (i + 1) + 50)); await tick();
  }
  assert.equal(h.controller.getSnapshot().phase, 'paused'); assert.equal(h.controller.getSnapshot().voiceError, 'recognition_failed');
  h.controller.stop();
});
