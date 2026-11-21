import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionController } from '../src/session/controller.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('a hardware-ended camera clears the preview and stops warnings until the user restarts it', async t => {
  let ended, releases = 0;
  const h = await session(t, 'en', { camera: async () => ({
    readDepth: () => ({ timestampMs: Date.now(), centerM: 1.2, nearM: 1.2 }),
    onEnded: listener => { ended = listener; }, release: () => { releases++; },
  }) });
  ended();
  await h.advance(900);
  assert.equal(h.controller.getSnapshot().cameraPaused, true);
  assert.equal(h.controller.getSnapshot().camera, false);
  assert.equal(h.controller.getSnapshot().depthState, undefined);
  assert.equal(releases, 1);
  assert.equal(h.spoken.length, 0);
});

test('an obstacle can vibrate during dictation without talking over the user', async t => {
  const buzz = [];
  const h = await session(t, 'en', { buzz: pulses => buzz.push(pulses) });
  const initial = buzz.length;
  h.partial('Please read');
  await h.range(1.5); await h.range(1.4); await h.range(1.3);
  assert.deepEqual(buzz.slice(initial), [2]);
  assert.equal(h.spoken.length, 0);
});

async function session(t, language = 'en', overrides = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: Date.UTC(2026, 1, 1) });
  const spoken = [], history = [], requests = [], recognizers = [];
  let reading = null, photos = 0;
  const picture = () => ({ timestampMs: Date.now(), centerM: 1.5, jpeg: '/9j/2Q==' });
  const camera = {
    readDepth: () => reading,
    depthSnapshot: async () => { photos++; return picture(); },
    release() {},
  };
  const ports = {
    preview: false, recognitionAvailable: true, streamingAvailable: false,
    allowed: () => true, uuid: () => crypto.randomUUID(),
    camera: async () => camera,
    recognition: async (_, events) => { recognizers.push(events); events.start(); return async () => {}; },
    speak: async (text, lang, start) => { spoken.push({ text, lang }); start(); return 'done'; },
    ask: async request => {
      requests.push(request);
      return {
        question_id: request.question_id, language: request.language,
        answer: 'The confirmed server answer.', uncertain: false, evidence_frame_ids: [],
      };
    },
    stopSpeech() {}, keepAwake() {}, answer: entry => history.push(entry), ...overrides,
  };
  const controller = new SessionController(ports);
  t.after(() => controller.dispose());
  await controller.start(language);
  assert.equal(controller.getSnapshot().phase, 'listening');
  spoken.length = 0; // The opening greeting has completed.
  return {
    controller, camera, spoken, history, requests, picture, photos: () => photos,
    read(value) { reading = value; },
    partial(text) { recognizers.at(-1).result(text, false); },
    async say(text, final = true) { recognizers.at(-1).result(text, final); await settle(); },
    async advance(ms) { t.mock.timers.tick(ms); await settle(); },
    async range(nearM, timestampMs = Date.now()) {
      reading = { timestampMs, nearM, centerM: nearM };
      t.mock.timers.tick(200);
      await settle();
    },
  };
}

for (const [lang, question] of [
  ['en', 'How far is it?'],
  ['fr', 'À quelle distance est cet objet ?'],
  ['ar', 'كم يبعد الجسم أمامي؟'],
]) {
  test(`center-distance questions in ${lang} use a local reading without a photo, server call or History entry`, async t => {
    const h = await session(t, lang);
    h.read({ timestampMs: Date.now(), centerM: 1.5, nearM: .7 });
    await h.say(question);
    assert.equal(h.spoken.length, 1);
    assert.equal(h.spoken[0].lang, lang);
    assert.equal(h.controller.getSnapshot().depthMessage, h.spoken[0].text);
    assert.match(h.spoken[0].text, /[1١][.,٫][5٥]/);
    assert.equal(h.photos(), 0);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.history, []);
  });
}

test('a stale reading cannot supply a spoken number', async t => {
  const h = await session(t);
  h.read({ timestampMs: Date.now() - 10_000, nearM: .5, centerM: 1.5 });
  await h.say('How far is it?');
  assert.equal(h.spoken.length, 1);
  assert.doesNotMatch(h.spoken[0].text, /1[.,]5/);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.history, []);
});

for (const [lang, question] of [
  ['en', 'How far is the door?'], ['fr', 'À quelle distance est la porte ?'], ['ar', 'كم يبعد الباب؟'],
]) {
  test(`a named ${lang} distance sends the synchronized snapshot and saves only the server answer`, async t => {
    const h = await session(t, lang);
    h.read({ timestampMs: Date.now(), centerM: .8 });
    await h.say(question);
    assert.equal(h.photos(), 1);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].depth, h.picture());
    assert.equal(h.requests[0].language, lang);
    assert.equal(h.history.length, 1);
    assert.equal(h.history[0].provenance, 'server');
    assert.equal(h.history[0].answer, h.spoken.at(-1).text);
    assert.ok(!JSON.stringify(h.history[0]).includes(h.picture().jpeg));
  });
}

test('Stop during named-object capture drops the late image, speech and History', async t => {
  const h = await session(t);
  let complete;
  h.camera.depthSnapshot = () => new Promise(resolve => { complete = resolve; });
  await h.say('How far is the door?');
  assert.equal(typeof complete, 'function');
  h.controller.stop();
  complete(h.picture());
  await settle();
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.history, []);
  assert.deepEqual(h.spoken, []);
});

test('normal vision questions keep their existing API and History path without opening a depth photo', async t => {
  const h = await session(t);
  await h.say('Read the sign');
  assert.equal(h.photos(), 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].question, 'Read the sign');
  assert.equal(h.requests[0].depth, undefined);
  assert.equal(h.history[0].provenance, 'server');
});

test('a named object without a reliable snapshot asks for a new view without guessing or uploading', async t => {
  const h = await session(t);
  // The camera currently has a center reading, but no aligned color image.
  h.read({ timestampMs: Date.now(), centerM: 1.25, nearM: 1.2 });
  h.camera.depthSnapshot = async () => null;
  await h.say('How far is the door?');
  assert.equal(h.spoken.length, 1);
  assert.doesNotMatch(h.spoken[0].text, /\d/);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.history, []);
});

test('an unsupported phone can explain distance unavailability without a cloud estimate', async t => {
  const h = await session(t, 'fr', { camera: async () => ({ release() {} }) });
  assert.equal(h.controller.getSnapshot().depthState, 'unavailable');
  await h.say('À quelle distance est la porte ?');
  assert.equal(h.spoken.length, 1);
  assert.equal(h.spoken[0].lang, 'fr');
  assert.doesNotMatch(h.spoken[0].text, /\d/);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.history, []);
});

test('a near obstacle does not speak over a partial user question or send it early', async t => {
  const h = await session(t);
  await h.say('Read the', false);
  assert.equal(h.controller.getSnapshot().phase, 'hearing');
  await h.range(1.5);
  await h.range(1.4);
  assert.deepEqual(h.spoken, []);
  assert.deepEqual(h.requests, []);
  await h.say('Read the sign');
  assert.equal(h.requests.length, 1);
  assert.equal(h.spoken[0].text, h.history[0].answer);
});

test('stale and repeated frames do not warn; sustained proximity warns once and clear frames rearm', async t => {
  const h = await session(t);
  await h.range(1.3, Date.now() - 10_000);
  const stamp = Date.now();
  await h.range(1.3, stamp);
  await h.range(1.3, stamp);
  assert.equal(h.spoken.length, 0);
  await h.range(1.3);
  assert.equal(h.spoken.length, 1);
  for (let i = 0; i < 20; i++) await h.range(1.2);
  assert.equal(h.spoken.length, 1);
  for (let i = 0; i < 3; i++) await h.range(2.5);
  await h.range(1.99);
  await h.range(1.99);
  assert.equal(h.spoken.length, 2);
  assert.deepEqual(h.history, []);
  assert.deepEqual(h.requests, []);
  assert.equal(h.photos(), 0);
});

test('crossing the threshold a second time during cooldown does not interrupt again', async t => {
  const h = await session(t);
  await h.range(2);
  await h.range(2);
  assert.equal(h.spoken.length, 0);
  await h.range(1.9);
  await h.range(1.9);
  assert.equal(h.spoken.length, 1);
  await h.advance(600); // Allow the recognizer to resume after the warning.
  for (let i = 0; i < 3; i++) await h.range(2.4);
  await h.range(1.7);
  await h.range(1.7);
  assert.equal(h.spoken.length, 1);
});

for (const action of ['pause', 'camera off', 'stop', 'SOS']) {
  test(`proximity does not speak during ${action} or add warning History`, async t => {
    const h = await session(t);
    await h.range(1.3);
    if (action === 'pause') h.controller.pause();
    if (action === 'stop') h.controller.stop();
    if (action === 'camera off') await h.say('Camera off');
    if (action === 'SOS') {
      await h.say('I need help');
      assert.equal(h.controller.getSnapshot().sos, 'countdown');
    }
    const spokenBefore = h.spoken.length;
    for (let i = 0; i < 5; i++) await h.range(1.1);
    assert.equal(h.spoken.length, spokenBefore);
    assert.deepEqual(h.history, []);
  });
}

test('turning off automatic warnings still permits an explicit distance question', async t => {
  const h = await session(t, 'en', { nearbyWarningsEnabled: () => false });
  for (let i = 0; i < 4; i++) await h.range(1.5);
  assert.equal(h.spoken.length, 0);
  await h.say('How far is it?');
  assert.equal(h.spoken.length, 1);
  assert.match(h.spoken[0].text, /1[.,]5/);
  assert.deepEqual(h.requests, []);
});
