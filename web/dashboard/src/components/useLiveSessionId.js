// Member 2: picks the stream to watch: a pasted session ID when there is one, otherwise whatever phone is live in MediaMTX.
import { useEffect, useState } from 'react';
import { mediaClient } from '../services/mediaClient.js';

const FIND_EVERY_MS = 3000;

export function useLiveSessionId(manualId) {
  const [foundId, setFoundId] = useState(null);

  useEffect(() => {
    if (manualId) return undefined;
    let cancelled = false;
    let timer;

    // Keeps checking, so a new ID after the phone taps Stop and Start is picked up too.
    const look = async () => {
      const id = await mediaClient.findLiveSessionId();
      if (cancelled) return;
      setFoundId(id);
      timer = window.setTimeout(look, FIND_EVERY_MS);
    };

    look();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manualId]);

  return manualId ?? foundId;
}
