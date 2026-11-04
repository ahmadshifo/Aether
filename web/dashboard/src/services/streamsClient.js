// Member 2: asks the AI backend which stream the signed-in account's phone is publishing (Vite forwards /api/v1/streams to :8002).
export const streamsClient = {
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
