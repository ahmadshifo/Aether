import { CloudVoice } from '../src/voice/cloudVoice';
import type { RecognitionEvents } from '../src/session/controller';
import type { VoiceApi } from '../src/voice/apiClient';

let mockRecording = false, mockMeter = -80, mockStarted = 0, mockPlayback: ((status: object) => void) | undefined;
const mockDeleted = jest.fn(), mockRelease = jest.fn(), mockWrite = jest.fn(), mockPlayerRemove = jest.fn();
const mockMode = jest.fn(async () => {}), mockStop = jest.fn(async () => { mockRecording = false; });
const mockAudio = {
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })), setAudioModeAsync: mockMode,
  RecordingPresets: { HIGH_QUALITY: {} },
  AudioModule: { AudioRecorder: class {
    uri = 'file:///voice-question.m4a';
    get isRecording() { return mockRecording; }
    prepareToRecordAsync = async () => {};
    record() { mockRecording = true; mockStarted = Date.now(); }
    stop = mockStop; release = mockRelease;
    getStatus() { return { isRecording: mockRecording, metering: mockMeter, durationMillis: Date.now() - mockStarted }; }
  } },
  createAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), remove: mockPlayerRemove,
    addListener: (_: string, fn: (status: object) => void) => { mockPlayback = fn; return { remove: jest.fn() }; },
  })),
};
jest.mock('../src/platform/capabilities', () => ({ loadAudio: () => mockAudio }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' }, File: class {
  uri: string; exists = true;
  constructor(...parts: string[]) { this.uri = parts.join('/'); }
  bytes = async () => new Uint8Array([1, 2, 3]); write = mockWrite;
  delete() { mockDeleted(this.uri); }
} }));
const events = (): RecognitionEvents => ({ start: jest.fn(), processing: jest.fn(), result: jest.fn(), end: jest.fn(), error: jest.fn() });
function setup() {
  const api: VoiceApi = { check: jest.fn(async () => {}), transcribe: jest.fn(async () => 'أين الباب؟'), synthesize: jest.fn(async () => new Uint8Array([73, 68, 51])) };
  return { voice: new CloudVoice(api), api, request: new AbortController(), event: events() };
}
async function sayQuestion() {
  mockMeter = -20; await jest.advanceTimersByTimeAsync(500);
  mockMeter = -80; await jest.advanceTimersByTimeAsync(1500);
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockRecording = false; mockPlayback = undefined; mockMeter = -80; });
afterEach(() => { jest.useRealTimers(); });

test('cloud recording sends the selected language once and deletes its local file', async () => {
  const { voice, api, request, event } = setup();
  await voice.prepare(request.signal);
  await voice.recognize('ar', event, request.signal);
  await sayQuestion();
  expect(api.transcribe).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'ar', expect.any(AbortSignal));
  expect(event.processing).toHaveBeenCalledTimes(1);
  expect(event.result).toHaveBeenCalledWith('أين الباب؟', true);
  expect(api.transcribe).toHaveBeenCalledTimes(1); expect(mockRecording).toBe(false);
  expect(mockDeleted).toHaveBeenCalledWith('file:///voice-question.m4a'); expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('silence never uploads audio', async () => {
  const { voice, api, request, event } = setup();
  await voice.recognize('en', event, request.signal); await jest.advanceTimersByTimeAsync(8100);
  expect(event.error).toHaveBeenCalledWith('no-speech'); expect(api.transcribe).not.toHaveBeenCalled(); expect(mockRecording).toBe(false);
});
test('Stop while recording immediately releases microphone and deletes the file', async () => {
  const { voice, api, request, event } = setup();
  const stop = await voice.recognize('fr', event, request.signal);
  request.abort(); await stop(); await jest.advanceTimersByTimeAsync(30000);
  expect(mockRecording).toBe(false); expect(mockRelease).toHaveBeenCalledTimes(1);
  expect(mockDeleted).toHaveBeenCalled(); expect(api.transcribe).not.toHaveBeenCalled(); expect(event.result).not.toHaveBeenCalled();
});
test('a late cancelled transcription cannot become a question', async () => {
  const { voice, api, request, event } = setup();
  let finish!: (text: string) => void;
  (api.transcribe as jest.Mock).mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
  const stop = await voice.recognize('ar', event, request.signal); await sayQuestion();
  request.abort(); await stop(); finish('أين الباب؟'); await jest.advanceTimersByTimeAsync(1);
  expect(event.result).not.toHaveBeenCalled(); expect(event.error).not.toHaveBeenCalled();
});
test('quota error is surfaced once with no fallback and recording cleanup', async () => {
  const { voice, api, request, event } = setup();
  (api.transcribe as jest.Mock).mockRejectedValue(Error('voice_quota'));
  await voice.recognize('en', event, request.signal); await sayQuestion();
  expect(event.error).toHaveBeenCalledWith('voice_quota'); expect(api.transcribe).toHaveBeenCalledTimes(1); expect(mockDeleted).toHaveBeenCalled();
});
test('MP3 playback completes and removes the player and cached audio', async () => {
  const { voice } = setup(), started = jest.fn(), speech = voice.speak('Bonjour tout le monde', 'fr', started);
  await jest.advanceTimersByTimeAsync(1); expect(mockWrite).toHaveBeenCalled();
  mockPlayback!({ playing: true }); mockPlayback!({ didJustFinish: true });
  expect(await speech).toBe('done'); expect(started).toHaveBeenCalledTimes(1); expect(mockPlayerRemove).toHaveBeenCalled(); expect(mockDeleted).toHaveBeenCalled();
});
test('Stop cancels active speech and prevents late playback after a pending synthesis', async () => {
  const { voice, api } = setup();
  const first = voice.speak('Hello world', 'en', jest.fn()); await jest.advanceTimersByTimeAsync(1);
  voice.stop(); expect(await first).toBe('cancelled'); expect(mockPlayerRemove).toHaveBeenCalledTimes(1);
  let finish!: (bytes: Uint8Array) => void;
  (api.synthesize as jest.Mock).mockImplementation(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  const second = voice.speak('Hello again', 'en', jest.fn()); voice.stop(); finish(new Uint8Array([1, 2, 3]));
  expect(await second).toBe('cancelled'); expect(mockAudio.createAudioPlayer).toHaveBeenCalledTimes(1);
});
