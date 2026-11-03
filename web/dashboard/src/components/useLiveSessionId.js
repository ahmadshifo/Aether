// Member 2: the stream to watch: the signed-in account's live session (from the AI backend),
// or, with login switched off, whatever phone is live in MediaMTX.
import { useEffect, useState } from 'react';
import { AUTH_ENABLED } from '../auth.js';
import { mediaClient } from '../services/mediaClient.js';
import { streamsClient } from '../services/streamsClient.js';

const FIND_EVERY_MS = 3000;

export const findLiveSessionId = () => (AUTH_ENABLED ? streamsClient.activeSessionId() : mediaClient.findLiveSessionId());

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
