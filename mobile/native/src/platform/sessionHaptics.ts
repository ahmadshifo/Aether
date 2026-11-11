import { Vibration } from 'react-native';

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export async function sessionHaptics(enabled: boolean, signal?: AbortSignal) {
  if (!enabled || signal?.aborted) return;
  const cancel = () => { try { Vibration.cancel(); } catch { /* Unsupported device. */ } };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Two full pulses, separated by 120 ms. iOS fixes each vibration at about
    // 400 ms; finish both before camera/dictation can suppress the feedback.
    for (const duration of [520, 400]) {
      if (signal?.aborted) return;
      Vibration.vibrate(400);
      await wait(duration, signal);
    }
  } catch { /* Feedback must not prevent a session. */ }
  finally { signal?.removeEventListener('abort', cancel); }
}
