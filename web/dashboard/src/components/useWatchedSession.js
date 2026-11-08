// Member 2: which phone session this browser is watching. Nothing plays until Connect; Disconnect stops it.
// Shared by Overview and Live camera, so moving between the pages keeps the choice.
// While connected, a new session after the phone's Stop and Start is followed; the phone stopping disconnects.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AUTH_ENABLED } from '../auth.js';
import { findLiveSessionId, useLiveSessionId } from './useLiveSessionId.js';

let state = { watching: null, looking: false, notice: '' };
const listeners = new Set();
const update = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;

const notStreaming = (email) => (AUTH_ENABLED && email
  ? `Your phone isn't streaming yet. Open the Aether app, signed in as ${email}, press Start, then press Connect.`
  : 'No phone is streaming yet. Press Start in the Aether app, then press Connect.');

export function useWatchedSession(email) {
  const current = useSyncExternalStore(subscribe, snapshot);
  const liveId = useLiveSessionId(); // undefined until the first check, then the phone's session or null

  useEffect(() => {
    if (!state.watching || liveId === undefined) return;
    if (liveId === null) update({ watching: null, notice: 'The phone stopped streaming. Press Connect when it starts again.' });
    else if (liveId !== state.watching) update({ watching: liveId });
  }, [liveId]);

  const connect = useCallback(async () => {
    if (state.watching || state.looking) return;
    update({ looking: true, notice: '' });
    const id = await findLiveSessionId();
    if (!state.looking) return; // Disconnect was pressed while looking
    update(id ? { looking: false, watching: id } : { looking: false, notice: notStreaming(email) });
  }, [email]);

  const disconnect = useCallback(() => update({ watching: null, looking: false, notice: '' }), []);

  return { ...current, liveId, connect, disconnect };
}
