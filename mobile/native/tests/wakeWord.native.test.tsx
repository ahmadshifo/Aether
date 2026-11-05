import { listenForWakeWord } from '../src/voice/wakeWord';
import { recognize } from '../src/voice/recognition';
import type { RecognitionEvents } from '../src/session/controller';
jest.mock('../src/voice/recognition', () => ({ recognize: jest.fn() }));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let events: RecognitionEvents;
beforeEach(() => jest.resetAllMocks());

test('repeated partial/final wake matches open once, only after microphone release', async () => {
  let release!: () => void;
  const released = new Promise<void>(done => { release = done; }), wake = jest.fn(), unavailable = jest.fn();
  (recognize as jest.Mock).mockImplementation(async (_, callbacks) => { events = callbacks; return () => released; });
  const stop = listenForWakeWord(wake, unavailable); await tick();
  events.result('Hey Aether', false); events.result('Hey Aether', true); await tick(); expect(wake).not.toHaveBeenCalled();
  release(); await tick(); expect(wake).toHaveBeenCalledTimes(1); expect(unavailable).not.toHaveBeenCalled(); await stop();
});

test('leaving during wake handoff cancels the pending launch', async () => {
  let release!: () => void;
  const released = new Promise<void>(done => { release = done; }), wake = jest.fn();
  (recognize as jest.Mock).mockImplementation(async (_, callbacks) => { events = callbacks; return () => released; });
  const stop = listenForWakeWord(wake, jest.fn()); await tick(); events.result('Hey Aether', true);
  const stopping = stop(); release(); await stopping; await tick(); expect(wake).not.toHaveBeenCalled();
});

test('stop waits for late recognizer startup and prevents late wake events', async () => {
  let started!: (release: () => Promise<void>) => void;
  const startup = new Promise<() => Promise<void>>(resolve => { started = resolve; }), release = jest.fn(async () => {}), wake = jest.fn();
  (recognize as jest.Mock).mockImplementation((_, callbacks) => { events = callbacks; return startup; });
  const stop = listenForWakeWord(wake, jest.fn()); await tick();
  let settled = false; const stopping = stop().then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
  started(release); await stopping; events.result('Hey Aether', true); await tick(); expect(release).toHaveBeenCalled(); expect(wake).not.toHaveBeenCalled();
});

test('fatal permission errors disable wake once; cancelled startup does not disable a new preference', async () => {
  const unavailable = jest.fn();
  (recognize as jest.Mock).mockImplementation(async (_, callbacks) => { events = callbacks; return async () => {}; });
  const stop = listenForWakeWord(jest.fn(), unavailable); await tick();
  events.error('not-allowed'); events.error('not-allowed'); await tick(); expect(unavailable).toHaveBeenCalledTimes(1); await stop();
  let reject!: (error: Error) => void;
  (recognize as jest.Mock).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const stopNext = listenForWakeWord(jest.fn(), unavailable); await tick(); const stopping = stopNext(); reject(Error('cancelled')); await stopping; await tick();
  expect(unavailable).toHaveBeenCalledTimes(1);
});
