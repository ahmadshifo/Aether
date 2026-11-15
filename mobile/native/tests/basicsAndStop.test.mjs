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

test('cloud questions use a separate stop recognizer while speech plays', async () => {
  const interrupts = [];
  let released = 0;
  const h = harness({ interruptRecognition: async (_, callbacks) => {
    interrupts.push(callbacks); return async () => { released++; };
  } });
  try {
    await h.controller.start('en');
    h.events.at(-1).result('What is in front of me', true);
    await settle();
    assert.equal(h.controller.getSnapshot().phase, 'speaking');
    assert.equal(h.events.length, 1, 'no cloud recording during playback');
    assert.equal(interrupts.length, 1);
    interrupts[0].result('stop', true);
    await h.listening();
    assert.equal(h.controller.getSnapshot().phase, 'listening');
    assert.equal(released, 1);
    assert.equal(h.events.length, 2, 'cloud recording resumes after stopping playback');
  } finally { h.controller.stop(); }
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

test('what can I ask, speak slower and speak faster are commands in three languages', () => {
  for (const sentence of ['What can I ask?', 'what can you do', 'شو بقدر اسأل', "qu'est-ce que je peux demander"]) assert.equal(detectCommand(sentence), 'examples', sentence);
  for (const sentence of ['speak slower', 'Slow down', 'احكي أبطأ', 'plus lentement']) assert.equal(detectCommand(sentence), 'slower', sentence);
  for (const sentence of ['speak faster', 'talk faster please', 'أسرع', 'parle plus vite']) assert.equal(detectCommand(sentence), 'faster', sentence);
});

test('speed changes are said, the limit is said, and buzzes mark listening and a ready answer', async () => {
  let rate = 2;
  const buzzes = [];
  const h = harness({ changeSpeechRate: direction => { const next = rate + direction; if (next < 0 || next > 3) return null; rate = next; return next; }, buzz: times => buzzes.push(times) });
  await h.controller.start('en'); await h.listening();
  h.events.at(-1).result('speak faster', true); await h.listening();
  h.events.at(-1).result('speak faster', true); await h.listening();
  assert.equal(rate, 3);
  assert.match(h.spoken.at(-1), /fastest/);
  h.events.at(-1).result('what can I ask', true); await h.listening();
  assert.match(h.spoken.at(-1), /^You can ask:/);
  assert.ok(buzzes.includes(1));  // listening again after speaking
  buzzes.length = 0;
  h.events.at(-1).result('What is in front of me', true);
  await settle(); await wait(50); await settle();
  assert.deepEqual(buzzes, [2]);  // the answer is ready
  h.controller.stop();
});

test('the battery is sent to the dashboard when it changes, and caregiver notes are read aloud once', async () => {
  const reports = [], read = [];
  let battery, notes = [{ note_id: 'n1', text: 'Dinner is ready.' }];
  const h = harness({
    watchBattery: listener => { battery = listener; return () => {}; },
    reportBattery: async (id, level, charging) => { reports.push([Math.round(level), charging]); },
    pendingNotes: async () => notes,
    noteRead: async id => { read.push(id); notes = notes.filter(note => note.note_id !== id); },
  });
  await h.controller.start('en'); await h.listening();
  battery(0.64, false); battery(0.641, false); battery(0.64, true);
  assert.deepEqual(reports, [[64, false], [64, true]]);  // same whole percent: not sent again
  await h.listening(); await h.listening();
  assert.equal(h.spoken.filter(text => text === 'Message from your caregiver: Dinner is ready.').length, 1);
  assert.deepEqual(read, ['n1']);
  h.controller.stop();
});
