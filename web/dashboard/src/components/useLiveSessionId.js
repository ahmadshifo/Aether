// Member 2: the stream to watch: the signed-in account's live session (from the AI backend).
import { useEffect, useState } from 'react';
import { streamsClient } from '../services/streamsClient.js';

const FIND_EVERY_MS = 3000;

export const findLiveSessionId = () => streamsClient.activeSessionId();

// undefined until the first check, then the live session ID or null. Keeps checking, so the phone's Stop and Start are picked up.
export function useLiveSessionId() {
  const [sessionId, setSessionId] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const look = async () => {
      const id = await findLiveSessionId();
      if (cancelled) return;
      setSessionId(id);
      timer = window.setTimeout(look, FIND_EVERY_MS);
    };

    look();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return sessionId;
}

// True while the user has said "camera off" on the phone, so the live view shows that instead of an error.
export function useCameraPaused(sessionId) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!sessionId) { setPaused(false); return undefined; }
    let cancelled = false;
    let timer;
    const look = async () => {
      const session = await streamsClient.activeSession();
      if (cancelled) return;
      setPaused(Boolean(session && session.session_id === sessionId && session.camera_paused));
      timer = window.setTimeout(look, FIND_EVERY_MS);
    };
    look();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionId]);

  return paused;
}
