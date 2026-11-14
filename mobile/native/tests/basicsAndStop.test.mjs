// "Stop" while the phone talks, and the basics it answers by itself (time, date, battery, connection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCommand, heardStop } from '../src/voice/commands.ts';
import { batteryAnswer, connectionAnswer, dateAnswer, timeAnswer } from '../src/voice/basics.ts';
import { SessionController } from '../src/session/controller.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('stop counts only as a short phrase that is not part of what is being read', () => {
  for (const [heard, reading] of [['Stop', 'A red mug.'], ['stop talking', 'A door.'], ['وقف', 'باب'], ['arrête', 'Une porte.'], ['OK stop', 'A chair.']]) {
    assert.equal(heardStop(heard, reading), true, heard);
  }
  for (const [heard, reading] of [['stop', 'There is a stop sign ahead.'], ['A red mug on your', 'A red mug on your right.'], ['stop the car please now', 'x']]) {
    assert.equal(heardStop(heard, reading), false, heard);
  }
});

test('basics are recognised, but questions about the view stay questions', () => {
  const cases = {
    time: ['What time is it?', "what's the time", 'قديش الساعة', 'quelle heure est-il'],
    date: ['What day is it today', "what's the date", 'شو التاريخ اليوم', 'quel jour sommes-nous'],
    battery: ["What's my battery?", 'how much battery do I have', 'battery level', 'قديش البطارية', 'niveau de batterie'],
    internet: ['Am I connected?', 'is there internet', 'am I online', 'في انترنت', 'je suis connecté'],
  };
  for (const [command, sentences] of Object.entries(cases)) for (const sentence of sentences) assert.equal(detectCommand(sentence), command, sentence);
  for (const question of ['Is there a battery on the table?', 'What time does this sign say?', 'Where is the wifi router']) {
    assert.equal(detectCommand(question), null, question);
  }
});

test('basic answers in each language', () => {
  assert.equal(batteryAnswer('en', { level: 0.64, charging: false }), 'Your battery is at 64 percent.');
  assert.equal(batteryAnswer('fr', { level: 0.5, charging: true }), 'La batterie est à 50 pour cent et en charge.');
  assert.match(batteryAnswer('ar', null), /لا يمكنني/);
  assert.equal(connectionAnswer('en', { internet: true, server: true, video: true }), "You're connected to the internet and to Aether.");
  assert.match(connectionAnswer('en', { internet: false, server: false, video: false }), /no internet/);
  assert.match(connectionAnswer('en', { internet: true, server: false, video: false }), /can't reach the Aether server/);
  const now = new Date(2026, 10, 15, 15, 5);
  assert.match(timeAnswer('en', now), /^It is 3:05/);
  assert.match(dateAnswer('en', now), /Sunday.*15.*November.*2026/);
});

function harness(overrides = {}) {
  const spoken = [], asked = [], events = [];
  let stopped = 0, finishSpeech;
  const ports = {
    preview: false, recognitionAvailable: true, streamingAvailable: false, uuid: () => crypto.randomUUID(), allowed: () => true,
    ask: async r => { asked.push(r.question); return { question_id: r.question_id, language: r.language, answer: 'A closed door straight ahead, and a chair on your left.', uncertain: false, evidence_frame_ids: [] }; },
    camera: async () => ({ release: () => {} }),
    recognition: async (_, callbacks) => { events.push(callbacks); callbacks.start(); return async () => {}; },
    // The test answer keeps "speaking" until stopSpeech; everything else finishes at once.
    speak: (text, _, start) => { spoken.push(text); start(); if (!text.startsWith('A closed door')) return Promise.resolve('done'); return new Promise(resolve => { finishSpeech = resolve; }); },
    stopSpeech: () => { stopped++; finishSpeech?.('cancelled'); finishSpeech = undefined; },
    publish: () => ({ start: async () => {}, stop: () => {} }), register: async () => {}, keepAwake: () => {}, answer: () => {},
    batteryLevel: async () => ({ level: 0.42, charging: false }),
    connectivity: async () => ({ internet: false, server: false }),
    ...overrides,
  };
  const controller = new SessionController(ports);
  const listening = async () => { await settle(); await wait(600); await settle(); };
  return { controller, spoken, asked, events, listening, stopped: () => stopped };
}

test('saying stop while an answer is read stops it and goes back to listening', async () => {
  const h = harness();
  await h.controller.start('en'); await h.listening();
  h.events.at(-1).result('What is in front of me', true);
  await settle(); await wait(50); await settle();
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  const stopListener = h.events.at(-1);  // started when the answer began
  stopListener.result('A closed door straight', false);  // the phone hearing itself: ignored
  await settle();
  assert.equal(h.controller.getSnapshot().phase, 'speaking');
  stopListener.result('stop', true);
  await h.listening();
  assert.equal(h.controller.getSnapshot().phase, 'listening');
  assert.ok(h.stopped() > 0);
  h.controller.stop();
});

test('time, battery and connection are answered without asking the server', async () => {
  const h = harness();
  await h.controller.start('en'); await h.listening();
  for (const sentence of ['what time is it', "what's my battery", 'am I connected']) {
    h.events.at(-1).result(sentence, true); await h.listening();
  }
  assert.deepEqual(h.asked, []);
  assert.match(h.spoken.join(' | '), /It is .*\| Your battery is at 42 percent\. \| There's no internet/);
  h.controller.stop();
});
