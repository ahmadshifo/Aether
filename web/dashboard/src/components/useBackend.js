// Member 2: live data from the AI backend for the dashboard pages.
// useStatus: service health, re-checked every 15 s and on demand. useQuestions: the account's Q&A history.
import { useCallback, useEffect, useRef, useState } from 'react';
import { assistantClient } from '../services/assistantClient.js';

const STATUS_EVERY_MS = 15000;
const UNKNOWN = { streaming: 'connecting', multimedia: 'connecting', ai: 'connecting' };

export function useStatus() {
  const [state, setState] = useState({ status: UNKNOWN, details: {}, liveSession: null, loaded: false, error: null, checking: true });
  const timer = useRef(0);
  const alive = useRef(true);

  const check = useCallback(async () => {
    window.clearTimeout(timer.current);
    setState((current) => ({ ...current, checking: true }));
    try {
      const data = await assistantClient.status();
      if (!alive.current) return;
      setState({
        status: { streaming: data.streaming, multimedia: data.multimedia, ai: data.ai },
        details: data.details ?? {}, liveSession: data.live_session, loaded: true, error: null, checking: false,
      });
    } catch (error) {
      if (!alive.current) return;
      // The AI backend itself is unreachable: nothing behind it can be confirmed either.
      setState({ status: { streaming: 'offline', multimedia: 'offline', ai: 'offline' },
        details: { ai: error.message }, liveSession: null, loaded: true, error: error.message, checking: false });
    }
    if (alive.current) timer.current = window.setTimeout(check, STATUS_EVERY_MS);
  }, []);

  useEffect(() => {
    alive.current = true;
    check();
    return () => { alive.current = false; window.clearTimeout(timer.current); };
  }, [check]);

  return { ...state, check };
}

export function useQuestions() {
  const [state, setState] = useState({ questions: [], demo: false, loading: true, error: null });
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await assistantClient.questions();
      setState({ questions: data.questions, demo: data.demo, loading: false, error: null });
    } catch (error) {
      setState({ questions: [], demo: false, loading: false, error: error.message });
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
