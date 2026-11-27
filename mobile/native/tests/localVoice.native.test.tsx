jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('../src/platform/network', () => ({ nativeFetch: jest.fn() }));
jest.mock('../src/voice/recognition', () => ({ prepareRecognition: jest.fn(), recognize: jest.fn(async () => jest.fn()) }));
jest.mock('../src/platform/permissions', () => ({ duringPermission: (fn: () => unknown) => fn() }));
import { LocalVoice } from '../src/voice/localVoice';
import { recognize } from '../src/voice/recognition';
import { nativeFetch } from '../src/platform/network';

const events = () => ({ start: jest.fn(), end: jest.fn(), error: jest.fn(), result: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); });

test('old builds clearly fall back to device recognition', async () => {
  const notice = jest.fn(), voice = new LocalVoice('http://localhost:8002', notice, jest.fn(), null);
  const signal = new AbortController().signal;
  await voice.recognize('ar', events(), signal);
  expect(notice).toHaveBeenCalledWith('ar');
  expect(recognize).toHaveBeenCalled();
  expect(await voice.speak('مرحبا', 'ar', 1, jest.fn(), signal)).toBeNull();
  expect(nativeFetch).not.toHaveBeenCalled();
});

test('unreachable service falls back and a stopped request never starts device recognition', async () => {
  const notice = jest.fn(), audio: any = { prepare: jest.fn(async () => true), stopCapture: jest.fn(async () => {}) };
  (nativeFetch as jest.Mock).mockRejectedValue(Error('offline'));
  const voice = new LocalVoice('http://localhost:8002', notice, jest.fn(), audio);
  await voice.recognize('fr', events(), new AbortController().signal);
  expect(recognize).toHaveBeenCalledTimes(1);
  const aborted = new AbortController(); aborted.abort();
  const second = new LocalVoice('http://localhost:8002', notice, jest.fn(), audio);
  await second.recognize('fr', events(), aborted.signal);
  expect(recognize).toHaveBeenCalledTimes(1);
});

test('local WAV is played from memory and abort stops playback', async () => {
  let start: () => void = () => {}, finish: (value: string) => void = () => {};
  const audio: any = { addListener: jest.fn((name, fn) => { start = fn; return { remove: jest.fn() }; }),
    stopPlayback: jest.fn(async () => { finish('cancelled'); }),
    play: jest.fn(() => new Promise(resolve => { finish = resolve; start(); })) };
  (nativeFetch as jest.Mock).mockResolvedValue(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }));
  const voice = new LocalVoice('http://localhost:8002', jest.fn(), jest.fn(), audio);
  const signal = new AbortController(), started = jest.fn();
  const pending = voice.speak('hello', 'en', .8, started, signal.signal);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(audio.play).toHaveBeenCalledWith('UklGRg==', .8);
  expect(started).toHaveBeenCalledTimes(1);
  signal.abort();
  expect(await pending).toBe('cancelled');
  expect(audio.stopPlayback).toHaveBeenCalled();
});
