export type AuthUser = Readonly<{ user_id: string; email: string; name: string; created_at: string }>
export type LoginInput = { email: string; password: string }
export type SignupInput = LoginInput & { name: string }
export interface AuthClient {
  me(signal?: AbortSignal): Promise<AuthUser | null>
  login(input: LoginInput, signal?: AbortSignal): Promise<AuthUser>
  signup(input: SignupInput, signal?: AbortSignal): Promise<AuthUser>
  logout(signal?: AbortSignal): Promise<void>
}
export class AuthError extends Error {
  readonly code: string
  readonly status: number
  readonly uncertain: boolean
  constructor(code: string, status = 0, uncertain = false) {
    super(code); this.name = 'AuthError'; this.code = code; this.status = status; this.uncertain = uncertain
  }
}
export function parseUser(data: unknown): AuthUser {
  const user = (data as { user?: Partial<AuthUser> } | null)?.user
  if (!user || typeof user.user_id !== 'string' || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(user.user_id)
    || typeof user.email !== 'string' || !user.email || typeof user.name !== 'string' || !user.name
    || typeof user.created_at !== 'string' || !Number.isFinite(Date.parse(user.created_at))) throw new AuthError('malformed')
  return Object.freeze({ user_id: user.user_id, email: user.email, name: user.name, created_at: user.created_at })
}
export function createAuthClient(fetcher: typeof fetch = fetch, timeoutMs = 10_000): AuthClient {
  async function call(path: string, body?: LoginInput | SignupInput, signal?: AbortSignal) {
    const request = new AbortController()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) request.abort()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; request.abort() }, timeoutMs)
    const mutation = path !== '/me'
    try {
      const response = await fetcher(`/api/v1/auth${path}`, {
        method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: request.signal,
      })
      if (path === '/me' && response.status === 401) return null
      if (path === '/logout' && response.status === 204) return null
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const code = typeof data?.error?.code === 'string' ? data.error.code : 'unavailable'
        throw new AuthError(response.status >= 500 ? 'unavailable' : code, response.status, mutation && response.status >= 500)
      }
      if (response.status !== (path === '/signup' ? 201 : 200) || path === '/logout') throw new AuthError('malformed', 0, mutation)
      try { return parseUser(data) } catch { throw new AuthError('malformed', 0, mutation) }
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError(timedOut ? 'timeout' : signal?.aborted ? 'cancelled' : 'unavailable', 0, mutation)
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    me: signal => call('/me', undefined, signal),
    login: async ({ email, password }, signal) => (await call('/login', { email, password }, signal))!,
    signup: async (input, signal) => (await call('/signup', input, signal))!,
    logout: async signal => { await call('/logout', undefined, signal) },
  }
}

// Python validates Unicode code points, not UTF-16 code units. Passwords stay exact.
export function validateAuth(mode: 'login' | 'signup', input: SignupInput, confirmation: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim()) || [...input.email.trim()].length > 254) return 'invalid_email'
  if (mode === 'signup') {
    if (![...input.name.trim()].length || [...input.name.trim()].length > 80) return 'invalid_name'
    if ([...input.password].length < 8 || [...input.password].length > 128) return 'weak_password'
    if (input.password !== confirmation) return 'mismatch'
  } else if (!input.password) return 'password_required'
  return ''
}
