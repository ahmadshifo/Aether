// Spoken commands: what counts as SOS / cancel / camera off / camera on / read it again,
// and how the session handles each one (no network, no real speech).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCommand, commandCopy } from '../src/voice/commands.ts';
import { SessionController } from '../src/session/controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

test('help phrases start an SOS only when they are the whole sentence', () => {
  for (const phrase of ['SOS', 'I need help', 'help me!', 'Help', 'emergency', 'ساعدني', 'بدي مساعدة', 'au secours', "J'ai besoin d'aide"]) {
    assert.equal(detectCommand(phrase), 'sos', phrase);
  }
  for (const question of ['Can you help me read this sign?', 'help me find my keys please now', 'What is in front of me']) {
    assert.equal(detectCommand(question), null, question);
  }
});

test('camera, cancel and repeat commands in three languages', () => {
  assert.equal(detectCommand('Camera off.'), 'cameraOff');
  assert.equal(detectCommand('turn off the camera'), 'cameraOff');
  assert.equal(detectCommand('أطفئ الكاميرا'), 'cameraOff');
  assert.equal(detectCommand('éteins la caméra'), 'cameraOff');
  assert.equal(detectCommand('camera on'), 'cameraOn');
  assert.equal(detectCommand('شغّل الكاميرا'), 'cameraOn');
  assert.equal(detectCommand('Read it again'), 'repeat');
  assert.equal(detectCommand('عيد'), 'repeat');
  assert.equal(detectCommand('répète'), 'repeat');
  assert.equal(detectCommand('cancel'), 'cancel');
  assert.equal(detectCommand('إلغاء'), 'cancel');
});

function harness(overrides = {}) {
  const spoken = [], asked = [], calls = [], paused = [], sos = [], events = [];
  let releases = 0, cameras = 0;
  const ports = {
    preview: false, recognitionAvailable: true, streamingAvailable: true, uuid: () => crypto.randomUUID(), allowed: () => true,
    ask: async r => { asked.push(r.question); return { question_id: r.question_id, language: r.language, answer: 'The door is open.', uncertain: false, evidence_frame_ids: [] }; },
    camera: async () => { cameras++; return { release: () => releases++ }; },
    recognition: async (_, callbacks) => { events.push(callbacks); callbacks.start(); return async () => {}; },
    speak: async (text, _, start) => { spoken.push(text); start(); return 'done'; }, stopSpeech: () => {},
    publish: () => ({ start: async () => {}, stop: () => {} }), register: async () => {}, keepAwake: () => {}, answer: () => {},
    sos: async id => { sos.push(id); return { sos_number: '+9613000000' }; },
    sosNumber: async () => '+9613000000',
    call: async number => { calls.push(number); },
    cameraPaused: async (id, value) => { paused.push(value); },
    ...overrides,
  };
  const controller = new SessionController(ports);
  // After the phone speaks it starts listening again 450 ms later, so wait like a person before the next sentence.
  const say = async text => { events.at(-1).result(text, true); await settle(); await new Promise(resolve => setTimeout(resolve, 600)); await settle(); };
  return { controller, spoken, asked, calls, paused, sos, say, counts: () => ({ releases, cameras }) };
}

test('read it again repeats the last answer without asking the server again', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('What is in front of me');
  await h.say('read it again');
  assert.deepEqual(h.asked, ['What is in front of me']);
  assert.equal(h.spoken.filter(text => text === 'The door is open.').length, 2);
  h.controller.stop();
});

test('read it again before any answer says there is nothing to repeat', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('repeat');
  assert.equal(h.spoken.at(-1), commandCopy.en.nothingToRepeat);
  h.controller.stop();
});

test('camera off keeps listening, refuses questions, and camera on brings the camera back', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('camera off');
  let state = h.controller.getSnapshot();
  assert.equal(state.active, true); assert.equal(state.camera, false); assert.equal(state.cameraPaused, true);
  assert.equal(h.counts().releases, 1); assert.deepEqual(h.paused, [true]);
  await h.say('What is in front of me');
  assert.deepEqual(h.asked, []); assert.equal(h.spoken.at(-1), commandCopy.en.cameraOffQuestion);
  await h.say('camera on');
  state = h.controller.getSnapshot();
  assert.equal(state.cameraPaused, false); assert.equal(state.camera, true); assert.equal(h.counts().cameras, 2);
  assert.deepEqual(h.paused, [true, false]);
  h.controller.stop();
});

test('SOS waits for cancel, then sends the alert and calls the emergency number', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('I need help');
  assert.equal(h.controller.getSnapshot().sos, 'countdown');
  assert.equal(h.spoken.at(-1), commandCopy.en.sosCountdown);
  assert.deepEqual(h.sos, []);  // nothing is sent during the countdown
  await new Promise(resolve => setTimeout(resolve, 5200)); await settle();
  assert.equal(h.sos.length, 1);
  assert.equal(h.controller.getSnapshot().sos, 'sent');
  assert.equal(h.spoken.at(-1), commandCopy.en.sosSentCalling);
  assert.deepEqual(h.calls, ['+9613000000']);
  h.controller.stop();
});

test('saying cancel during the countdown sends nothing', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('SOS');
  await h.say('cancel');
  await new Promise(resolve => setTimeout(resolve, 5200)); await settle();
  assert.deepEqual(h.sos, []); assert.deepEqual(h.calls, []);
  assert.equal(h.controller.getSnapshot().sos, 'off');
  assert.equal(h.spoken.at(-1), commandCopy.en.sosCancelled);
  h.controller.stop();
});

test('if the alert cannot be sent, the phone still calls the saved number', async () => {
  const h = harness({ sos: async () => { throw Error('server_unavailable'); } });
  await h.controller.start('en');
  await h.say('help me');
  await new Promise(resolve => setTimeout(resolve, 5200)); await settle();
  assert.equal(h.controller.getSnapshot().sos, 'failed');
  assert.equal(h.spoken.at(-1), commandCopy.en.sosFailedCalling);
  assert.deepEqual(h.calls, ['+9613000000']);
  h.controller.stop();
});

function torchHarness(overrides = {}) {
  const log = [];
  const h = harness({
    torch: async on => { log.push(on ? 'torch on' : 'torch off'); return true; },
    call: async number => { log.push(`call ${number}`); },
    ...overrides,
  });
  return { ...h, log };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('SOS calls straight away with the flashlight on and the camera released', async () => {
  const h = torchHarness();
  await h.controller.start('en');
  await h.say('I need help');
  await wait(5200); await settle(); await wait(600); await settle();
  assert.equal(h.sos.length, 1);
  assert.equal(h.spoken.at(-1), commandCopy.en.sosSentCalling);
  // The streaming camera is released first, because the torch needs the camera hardware free.
  assert.equal(h.counts().releases, 1);
  assert.deepEqual(h.log, ['torch on', 'call +9613000000']);
  h.controller.stop();
});

test('with no emergency number the flashlight stays off and nobody is called', async () => {
  const h = torchHarness({ sos: async () => ({ sos_number: null }) });
  await h.controller.start('en');
  await h.say('SOS');
  await wait(5200); await settle(); await wait(600); await settle();
  assert.equal(h.spoken.at(-1), commandCopy.en.sosSentNoNumber);
  assert.deepEqual(h.log, []);
  h.controller.stop();
});

test('"call <name>" is a plain call; "help, call <name>" is an SOS that names who to call', async () => {
  const { sosContactName, callContactName } = await import('../src/voice/commands.ts');
  assert.equal(detectCommand('Call Mom'), 'call');
  assert.equal(callContactName('Call Mom'), 'mom');
  assert.equal(detectCommand('اتصل بأحمد'), 'call');
  assert.equal(callContactName('appelle Marie'), 'marie');
  assert.equal(detectCommand('call for help'), 'sos');  // still an emergency
  assert.equal(detectCommand('I need help, call Mom'), 'sos');
  assert.equal(sosContactName('I need help, call Mom'), 'mom');
  assert.equal(sosContactName('ساعدني اتصل بأحمد'), 'أحمد');
  assert.equal(sosContactName('I need help'), null);
});

function contactsHarness(found, overrides = {}) {
  const log = [];
  const h = harness({
    ...overrides,
    torch: async on => { log.push(on ? 'torch on' : 'torch off'); return true; },
    call: async number => { log.push(`call ${number}`); },
    findContact: async name => { log.push(`find ${name}`); return found[name ?? 'ICE'] ?? null; },
  });
  return { ...h, log };
}

test('"I need help, call Mom" calls Mom from the phone contacts, with the flashlight', async () => {
  const h = contactsHarness({ mom: { name: 'Mom', number: '+9617111111' } });
  await h.controller.start('en');
  await h.say('I need help, call Mom');
  await wait(5200); await settle(); await wait(600); await settle();
  assert.equal(h.sos.length, 1);
  assert.equal(h.spoken.at(-1), commandCopy.en.sosCallingName.replace('{name}', 'Mom'));
  assert.deepEqual(h.log.filter(line => !line.startsWith('find')), ['torch on', 'call +9617111111']);
  h.controller.stop();
});

test('near-miss words from speech recognition still work as commands', () => {
  assert.equal(detectCommand('camera of'), 'cameraOff');
  assert.equal(detectCommand('Cameras off'), 'cameraOff');
  assert.equal(detectCommand('turn of the camera'), 'cameraOff');
  assert.equal(detectCommand('cancle'), 'cancel');
  assert.equal(detectCommand('repet'), 'repeat');
  assert.equal(detectCommand('Kol Mom'), 'call');
  assert.equal(detectCommand('What is in front of me'), null);  // ordinary questions are untouched
});

test('the contact chosen in Settings wins over an ICE contact, so changing it takes effect', async () => {
  const h = contactsHarness({ ICE: { name: 'ICE Ahmad', number: '+9617222222' } });
  await h.controller.start('en');
  await h.say('SOS');
  await wait(5200); await settle(); await wait(600); await settle();
  assert.ok(h.log.includes('call +9613000000'));  // the saved/chosen number from the harness
  assert.ok(!h.log.includes('call +9617222222'));
  h.controller.stop();
});

test('with no contact chosen, a plain "I need help" calls the ICE contact from the phone', async () => {
  const h = contactsHarness({ ICE: { name: 'ICE Ahmad', number: '+9617222222' } }, { sos: async () => ({ sos_number: null }) });
  await h.controller.start('en');
  await h.say('SOS');
  await wait(5200); await settle(); await wait(600); await settle();
  assert.ok(h.log.includes('call +9617222222'));
  h.controller.stop();
});

test('"call Mom" calls without an alert or flashlight, and an unknown name is said out loud', async () => {
  const h = contactsHarness({ mom: { name: 'Mom', number: '+9617111111' } });
  await h.controller.start('en');
  await h.say('call Mom');
  assert.deepEqual(h.sos, []);
  assert.deepEqual(h.log, ['find mom', 'call +9617111111']);
  assert.equal(h.spoken.at(-1), commandCopy.en.callingName.replace('{name}', 'Mom'));
  await h.say('call Bob');
  assert.equal(h.spoken.at(-1), commandCopy.en.sosNameNotFound.replace('{name}', 'bob'));
  h.controller.stop();
});

test('stopping the session during the countdown cancels the SOS', async () => {
  const h = harness();
  await h.controller.start('en');
  await h.say('SOS');
  h.controller.stop();
  await new Promise(resolve => setTimeout(resolve, 5200)); await settle();
  assert.deepEqual(h.sos, []); assert.deepEqual(h.calls, []);
});
