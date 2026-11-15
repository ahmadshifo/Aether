// Member 2: asks the AI backend which stream the signed-in account's phone is publishing (Vite forwards /api/v1/streams to :8002).
export const streamsClient = {
  // The account's live session with its details ({ session_id, started_at, camera_paused }), or null.
  async activeSession() {
    try {
      const response = await fetch('/api/v1/streams/active', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()).session ?? null;
    } catch {
      return null;
    }
  },

  // This account's camera sessions from the last 24 hours, newest first: [{ session_id, status, started_at, ended_at }].
  async recentSessions() {
    const response = await fetch('/api/v1/streams/recent', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`Couldn't load your camera sessions (${response.status}).`);
    return (await response.json()).sessions;
  },

  // The newest live session ID for this account, or null when the phone isn't streaming or the backend can't be reached.
  async activeSessionId() {
    try {
      const response = await fetch('/api/v1/streams/active', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json();
      return data.session?.session_id ?? null;
    } catch {
      return null;
    }
  },
};
