// Member 2: calls Member 3's /api/v1/frames and /api/v1/frames/{id}/image endpoints.
// Vite forwards /api/v1/frames to the multimedia service (:8003); the login cookie is same-origin.
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

  imageUrl(frameId) {
    return `/api/v1/frames/${frameId}/image`;
  },
};
