// Member 2: calls the AI backend's /api/v1/auth endpoints; Vite proxies them to :8002 so the session cookie stays same-origin.
const BASE = '/api/v1/auth';
const OFFLINE = "Can't reach the AI backend. Is it running on port 8002?";

async function call(path, body, method = body ? 'POST' : 'GET') {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? OFFLINE);
    error.status = response.status;
    throw error;
  }
  return data.user;
}

// Resolves to the signed-in user, or null when nobody is logged in.
export const getCurrentUser = () => call('/me').catch((error) => {
  if (error.status === 401) return null;
  throw error;
});
export const signup = (name, email, password) => call('/signup', { name, email, password });
export const login = (email, password) => call('/login', { email, password });
export const logout = () => call('/logout', {});
export const updateProfile = (name) => call('/me', { name }, 'PATCH');
