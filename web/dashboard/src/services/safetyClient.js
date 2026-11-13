// Member 2: the AI backend's safety and summary endpoints (Vite forwards them to :8002; the login cookie is same-origin).
// - SOS number: GET/PUT /api/v1/settings
// - SOS alerts: GET /api/v1/sos, POST /api/v1/sos/{alert_id}/ack ("I'm on it")
// - Daily summary: GET /api/v1/summary?tz_offset=<minutes>

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin', cache: 'no-store',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined, ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
  }
  return response.json();
}

export const safetyClient = {
  // The number the phone calls after an SOS, or null when none is saved.
  async sosNumber() {
    return (await request('/api/v1/settings')).sos_number;
  },

  // Saves the number (an empty string clears it). Resolves to the cleaned number the phone will dial.
  async saveSosNumber(number) {
    return (await request('/api/v1/settings', { method: 'PUT', body: JSON.stringify({ sos_number: number }) })).sos_number;
  },

  // This account's SOS alerts from the last 24 hours, unacknowledged first.
  async alerts() {
    return (await request('/api/v1/sos')).alerts;
  },

  // "I'm on it": stops the alert on every dashboard signed in to this account.
  acknowledge(alertId) {
    return request(`/api/v1/sos/${alertId}/ack`, { method: 'POST' });
  },

  // Today's numbers, counted in this browser's time zone.
  summary() {
    return request(`/api/v1/summary?tz_offset=${new Date().getTimezoneOffset()}`);
  },
};
