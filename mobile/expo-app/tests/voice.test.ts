import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import { DeviceRecognition } from '../src/voice/DeviceRecognition';
import { words } from '../src/i18n/words';
class FakeRecognizer {
  listeners = new Map<string, Set<(event?: any) => void>>();
  starts: unknown[] = []; state = 'inactive';
  permission = Promise.resolve({ granted: true });
  isRecognitionAvailable() { return true; }
  requestPermissionsAsync() { return this.permission; }
  supportsOnDeviceRecognition() { return false; }
  async getSupportedLocales() { return { locales: ['en-US', 'ar-LB'], installedLocales: [] }; }
  async getStateAsync() { return this.state; }
  start(options: unknown) { this.starts.push(options); this.state = 'starting'; }
  abort() { this.state = 'inactive'; this.emit('end'); }
  addListener(event: string, callback: (event?: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return { remove: () => { this.listeners.get(event)?.delete(callback); } };
  }
  emit(event: string, data?: unknown) { [...this.listeners.get(event) ?? []].forEach(callback => callback(data)); }
}
function setup(fake: FakeRecognizer | null = new FakeRecognizer()) {
  const phases: string[] = []; const transcripts: string[] = []; const notices: string[] = []; const questions: string[] = [];
  const voice = new DeviceRecognition('ar', value => phases.push(value), value => transcripts.push(value),
    value => notices.push(value), async value => { questions.push(value); }, fake as unknown as typeof ExpoSpeechRecognitionModule | null);
  return { fake: fake!, voice, phases, transcripts, notices, questions };
}
test('missing native recognizer explains limitation and never claims listening', async () => {
  const { voice, phases, notices } = setup(null); await voice.start();
  assert.deepEqual(phases, []); assert.deepEqual(notices, [words.ar.voiceGo]); voice.stop();
});
test('Stop during permission request prevents late native start', async () => {
  let permit!: (value: { granted: boolean }) => void;
  const { fake, voice } = setup(); fake.permission = new Promise(resolve => { permit = resolve; });
  const pending = voice.start(); voice.stop(); permit({ granted: true }); await pending;
  assert.equal(fake.starts.length, 0);
});
test('permission denial has no listening state or fabricated transcript', async () => {
  const { fake, voice, phases, transcripts, notices } = setup(); fake.permission = Promise.resolve({ granted: false });
  await voice.start(); assert.deepEqual(phases, []); assert.deepEqual(transcripts, []);
  assert.equal(notices.at(-1), words.ar.voiceDenied); voice.stop();
});
test('real events drive phases; only final text is submitted after end', async () => {
  const { fake, voice, phases, transcripts, questions } = setup(); await voice.start();
  assert.deepEqual(phases, []); assert.equal(fake.starts.length, 1);
  fake.emit('start'); assert.deepEqual(phases, ['listening']);
  fake.emit('result', { isFinal: false, results: [{ transcript: 'ماذا' }] });
  assert.deepEqual(questions, []); assert.deepEqual(transcripts, ['ماذا']);
  fake.emit('result', { isFinal: true, results: [{ transcript: 'ماذا أمامي' }] });
  assert.deepEqual(questions, []);
  fake.state = 'inactive'; fake.emit('end');
  assert.deepEqual(questions, ['ماذا أمامي']); voice.stop();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(fake.starts.length, 1);
});
test('network error leaves an honest ready state; Stop detaches stale callbacks', async () => {
  const { fake, voice, phases, transcripts, notices } = setup(); await voice.start();
  fake.emit('start'); fake.emit('error', { error: 'network' });
  assert.equal(phases.at(-1), 'ready'); assert.equal(notices.at(-1), words.ar.voiceError);
  voice.stop(); const count = phases.length;
  fake.emit('result', { isFinal: true, results: [{ transcript: 'late' }] }); fake.emit('start');
  assert.deepEqual(transcripts, []); assert.equal(phases.length, count);
});
