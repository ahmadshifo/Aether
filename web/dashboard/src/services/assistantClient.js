// Member 2: calls its own /api/v1/questions and /api/v1/status endpoints for history and health.
// Vite forwards both to the AI backend (:8002); the login cookie is same-origin.

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  return response.json();
}

export const assistantClient = {
  // { questions, next_cursor, demo } for the signed-in account, newest first. demo is true while the
  // assistant has not answered anything yet and the backend returns sample records instead.
  questions({ sessionId, limit = 50, cursor } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (sessionId) params.set('session_id', sessionId);
    if (cursor) params.set('cursor', cursor);
    return request(`/api/v1/questions?${params}`);
  },

  // Permanently deletes this account's questions and answers. Resolves to { deleted }.
  deleteQuestions() {
    return request('/api/v1/questions', { method: 'DELETE' });
  },

  // { streaming, multimedia, ai, details, live_session } checked live by the AI backend.
  status() {
    return request('/api/v1/status');
  },
};
