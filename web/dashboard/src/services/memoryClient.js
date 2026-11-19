// Member 2: calls Member 3's /api/v1/frames and /api/v1/frames/{id}/image endpoints.
// Vite forwards /api/v1/frames to the multimedia service (:8003); the login cookie is same-origin.
import { streamsClient } from './streamsClient.js';

export const memoryClient = {
  // Saved, unexpired frames of one of this account's sessions, newest first (FrameMetadata from api-v1.yaml).
  async frames(sessionId, limit = 100) {
    const params = new URLSearchParams({ session_id: sessionId, limit: String(limit) });
    const response = await fetch(`/api/v1/frames?${params}`, { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 404) return []; // the session has no saved frames, or they have expired
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? `Couldn't load saved frames (${response.status}).`);
    }
    return (await response.json()).frames;
  },

  // Every saved frame of this account's recent sessions, newest first. A session that fails to load is skipped.
  async recentFrames() {
    const sessions = await streamsClient.recentSessions();
    const results = await Promise.allSettled(sessions.map((session) => this.frames(session.session_id)));
    const failed = results.filter((result) => result.status === 'rejected');
    if (sessions.length && failed.length === sessions.length) throw failed[0].reason;
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
      .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
  },

  imageUrl(frameId) {
    return `/api/v1/frames/${frameId}/image`;
  },
};
