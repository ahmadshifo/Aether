import { recognize } from './recognition';
import { heardWakeWord, WAKE_PHRASES } from './wakePhrase';

const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'];

// Listens only while the caller keeps it running; onWake fires after the microphone is released for the Assistant.
// Always uses English, even in Arabic mode: phones may have no offline Arabic speech, and this must stay on the device.
export function listenForWakeWord(onWake: () => void, onUnavailable: () => void) {
  const request = new AbortController();
  let stopCurrent: (() => Promise<void>) | undefined;
  let startup: Promise<() => Promise<void>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = '', previousAt = 0;
  let cancelled = false, triggered = false;
  let releasing: Promise<void> | undefined;

  const release = () => releasing ??= (async () => {
    request.abort();
    clearTimeout(timer);
    await Promise.allSettled([stopCurrent?.(), startup?.then(stop => stop())]);
  })();
  const stop = async () => { cancelled = true; await release(); };
  const finish = (callback: () => void) => {
    if (triggered || cancelled || request.signal.aborted) return;
    triggered = true;
    void release().then(() => { if (!cancelled) callback(); });
  };
  const restart = (ms: number) => {
    if (timer || request.signal.aborted) return;
    timer = setTimeout(async () => {
      timer = undefined;
      await stopCurrent?.(); // Removes the old listeners before starting again.
      stopCurrent = undefined;
      void run();
    }, ms);
  };
  const run = async () => {
    if (request.signal.aborted) return;
    try {
      startup = Promise.resolve().then(() => recognize('en', {
        start() {},
        result(text) {
          const now = Date.now();
          if (heardWakeWord(text, now - previousAt < 3000 ? previous : '')) { finish(onWake); return; }
          if (text.trim()) { previous = text; previousAt = now; }
        },
        end() { restart(300); },
        error(code) {
          if (FATAL.includes(code)) finish(onUnavailable);
          else restart(1000);
        },
      }, request.signal, { continuous: true, onDevice: true, phrases: WAKE_PHRASES }));
      stopCurrent = await startup;
      startup = undefined;
      if (request.signal.aborted) await stopCurrent();
    } catch {
      finish(onUnavailable);
    }
  };
  void run();
  return stop;
}
