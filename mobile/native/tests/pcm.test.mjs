import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode64, encode64, wav16, UtteranceBuffer } from '../src/voice/pcm.ts';

test('PCM roundtrips base64 and is packed into a valid mono 16 kHz WAV', () => {
  const input = Uint8Array.from([1, 0, 255, 127, 0, 128]);
  assert.deepEqual(decode64(encode64(input)), input);
  const wav = wav16([input]), view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), input.length);
  assert.deepEqual(wav.subarray(44), input);
});
test('silence does not trigger inference; speech ends after bounded silence', () => {
  const vad = new UtteranceBuffer(), chunk = new Uint8Array(3200);
  for (let i = 0; i < 300; i++) assert.equal(vad.push(chunk, 0), null);
  for (let i = 0; i < 5; i++) assert.equal(vad.push(chunk, .1), null);
  for (let i = 0; i < 6; i++) assert.equal(vad.push(chunk, 0), null);
  const wav = vad.push(chunk, 0);
  assert.ok(wav && wav.length < 60000);
  assert.equal(vad.push(chunk, 0), null);
});
test('continuous speech is bounded to 15 seconds and clear drops pending audio', () => {
  const vad = new UtteranceBuffer(), chunk = new Uint8Array(3200);
  for (let i = 0; i < 149; i++) assert.equal(vad.push(chunk, .1), null);
  assert.equal(vad.push(chunk, .1).length, 480044);
  vad.push(chunk, .1); vad.clear();
  for (let i = 0; i < 10; i++) assert.equal(vad.push(chunk, 0), null);
});
