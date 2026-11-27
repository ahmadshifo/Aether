jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('../src/platform/network', () => ({ nativeFetch: jest.fn() }));
jest.mock('../src/voice/recognition', () => ({ prepareRecognition: jest.fn(), recognize: jest.fn(async () => jest.fn()) }));
jest.mock('../src/platform/permissions', () => ({ duringPermission: (fn: () => unknown) => fn() }));
import { LocalVoice } from '../src/voice/localVoice';
import { recognize } from '../src/voice/recognition';
import { nativeFetch } from '../src/platform/network';
import { encode64 } from '../src/voice/pcm';

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
  let start: (value: unknown) => void = () => {}, finish: (value: string) => void = () => {};
  const audio: any = { addListener: jest.fn((name, fn) => { start = fn; return { remove: jest.fn() }; }),
    stopPlayback: jest.fn(async () => { finish('cancelled'); }),
    play: jest.fn((wav, rate, id) => new Promise(resolve => { finish = resolve; start({ playback_id: id }); })) };
  (nativeFetch as jest.Mock).mockResolvedValue(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }));
  const voice = new LocalVoice('http://localhost:8002', jest.fn(), jest.fn(), audio);
  const signal = new AbortController(), started = jest.fn();
  const pending = voice.speak('hello', 'en', .8, started, signal.signal);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(audio.play).toHaveBeenCalledWith('UklGRg==', .8, expect.any(String));
  expect(started).toHaveBeenCalledTimes(1);
  signal.abort();
  expect(await pending).toBe('cancelled');
  expect(audio.stopPlayback).toHaveBeenCalled();
});

test('capture submits a bounded in-memory utterance with its language and ignores stale events', async () => {
  const listeners = new Map<string, (value: unknown) => void>();
  let captureId = '';
  const audio: any = {
    prepare: jest.fn(async () => true),
    startCapture: jest.fn(async id => { captureId = id; }), stopCapture: jest.fn(async () => {}),
    addListener: (name, fn) => { listeners.set(name, fn); return { remove: () => listeners.delete(name) }; },
  };
  (nativeFetch as jest.Mock).mockImplementation(async url => new Response(JSON.stringify(
    String(url).endsWith('health') ? { status: 'ready' } : { text: 'أين الباب؟', lang: 'ar' }),
    { headers: { 'content-type': 'application/json' } }));
  const voice = new LocalVoice('http://localhost:8002', jest.fn(), jest.fn(), audio), heard = events();
  const stop = await voice.recognize('ar', heard, new AbortController().signal);
  const emit = listeners.get('audio')!;
  const pcm = encode64(new Uint8Array(3200));
  for (let i = 0; i < 160; i++) emit({ pcm, rms: .1, capture_id: 'old' });
  expect(nativeFetch).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 4; i++) emit({ pcm, rms: .1, capture_id: captureId });
  for (let i = 0; i < 7; i++) emit({ pcm, rms: 0, capture_id: captureId });
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  const [url, options] = (nativeFetch as jest.Mock).mock.calls[1];
  expect(url).toBe('http://localhost:8002/api/v1/voice/stt?lang=ar');
  expect(options.headers['Content-Type']).toBe('audio/wav');
  expect(options.body).toBeInstanceOf(ArrayBuffer);
  expect(heard.result).toHaveBeenCalledWith('أين الباب؟', true);
  expect(heard.end).toHaveBeenCalledTimes(1);
  expect(listeners.size).toBe(0);
  await stop();
});

test('stopping while the WAV body arrives prevents delayed playback', async () => {
  let finishBody: (value: ArrayBuffer) => void = () => {};
  const body = new Promise<ArrayBuffer>(resolve => { finishBody = resolve; });
  const audio: any = { play: jest.fn(), stopPlayback: jest.fn(async () => {}), addListener: jest.fn() };
  (nativeFetch as jest.Mock).mockResolvedValue({ ok: true, status: 200,
    headers: new Headers({ 'content-type': 'audio/wav' }), arrayBuffer: () => body });
  const voice = new LocalVoice('http://localhost:8002', jest.fn(), jest.fn(), audio);
  const controller = new AbortController();
  const playing = voice.speak('hello', 'en', 1, jest.fn(), controller.signal);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  controller.abort();
  finishBody(new Uint8Array([82, 73, 70, 70]).buffer);
  expect(await playing).toBe('cancelled');
  expect(audio.play).not.toHaveBeenCalled();
});
