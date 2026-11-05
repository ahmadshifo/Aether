import { recognize } from './recognition';
import { heardWakeWord, WAKE_PHRASES } from './wakePhrase';

const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'];

// Listens only while the caller keeps it running; onWake fires after the microphone is released for the Assistant.
// Always uses English, even in Arabic mode: phones may have no offline Arabic speech, and this must stay on the device.
export function listenForWakeWord(onWake: () => void, onUnavailable: () => void) {
  const request = new AbortController();
  let stopCurrent: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = '', previousAt = 0;

  const stop = async () => {
    request.abort();
    clearTimeout(timer);
    await stopCurrent?.();
  };
  const restart = (ms: number) => {
    if (timer || request.signal.aborted) return;
    timer = setTimeout(async () => {
      timer = undefined;
      await stopCurrent?.(); // Removes the old listeners before starting again.
      void run();
    }, ms);
  };
  const run = async () => {
    if (request.signal.aborted) return;
    try {
      stopCurrent = await recognize('en', {
        start() {},
        result(text) {
          const now = Date.now();
          if (heardWakeWord(text, now - previousAt < 3000 ? previous : '')) { void stop().then(onWake); return; }
          if (text.trim()) { previous = text; previousAt = now; }
        },
        end() { restart(300); },
        error(code) {
          if (FATAL.includes(code)) void stop().then(onUnavailable);
          else restart(1000);
        },
      }, request.signal, { continuous: true, onDevice: true, phrases: WAKE_PHRASES });
    } catch {
      if (!request.signal.aborted) void stop().then(onUnavailable);
    }
  };
  void run();
  return stop;
}
