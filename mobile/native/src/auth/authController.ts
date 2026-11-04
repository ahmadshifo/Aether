// Adapted from mobile/frontend/src/authController.ts at bb54dbd; original remains read-only.
import { AuthError } from './authClient.ts'
import type { AuthClient, AuthUser, SignupInput } from './authClient.ts'

// Nonsecret namespace: change deliberately if the authoritative test account DB changes.
export const AUTH_SOURCE = 'aether-native-sqlite-dev-v1'
export type AuthOwner = Readonly<{ userId: string; source: string; epoch: number }>
export type AuthSession = Readonly<{ user: AuthUser; owner: AuthOwner }>
export type AuthStatus = 'checking' | 'signed_out' | 'signed_in' | 'service_unavailable' | 'submitting' | 'signing_out' | 'logout_failed'
export type AuthState = Readonly<{ status: AuthStatus; session: AuthSession | null; error: string; notice: string }>
export type AuthHint = 'changing' | 'changed'
export class AuthController {
  private client: AuthClient
  private state: AuthState = { status: 'checking', session: null, error: '', notice: '' }
  private listeners = new Set<() => void>()
  private locks = new Set<(reason: 'check' | 'revoke') => void>()
  private request?: AbortController
  private generation = 0
  private ownerEpoch = 0
  private logoutRequired = false
  private busy = false
  private checking = false
  private announce: (hint: AuthHint) => void
  private source: string
  private fresh = false
  constructor(client: AuthClient, source: string, announce: (hint: AuthHint) => void = () => {}) { this.client = client; this.source = source; this.announce = announce }
  requireFresh() { this.fresh = true; this.begin('signed_out', true) }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  onLock = (listener: (reason: 'check' | 'revoke') => void) => { this.locks.add(listener); return () => { this.locks.delete(listener) } }
  authorized = (owner: AuthOwner) => this.state.status === 'signed_in' && this.state.session?.owner === owner
  clearError() { if (this.state.status === 'signed_out') this.publish({ ...this.state, error: '', notice: '' }) }
  private publish(state: AuthState) { this.state = Object.freeze(state); this.listeners.forEach(listener => listener()) }
  private begin(status: AuthStatus, revoke = false) {
    this.checking = false
    this.request?.abort(); this.request = new AbortController(); this.generation++
    // Change authority before cleanup callbacks; late callbacks fail closed immediately.
    this.state = { status, session: revoke ? null : this.state.session, error: '', notice: '' }
    this.locks.forEach(listener => listener(revoke ? 'revoke' : 'check'))
    this.publish(this.state)
    return { generation: this.generation, signal: this.request.signal }
  }
  private accept(user: AuthUser | null, notice = '') {
    if (this.logoutRequired && user) {
      this.publish({ status: 'logout_failed', session: null, error: 'logout_failed', notice: '' }); return
    }
    if (!user) {
      this.logoutRequired = false
      this.locks.forEach(listener => listener('revoke'))
      this.publish({ status: 'signed_out', session: null, error: '', notice }); return
    }
    let session = this.state.session
    if (session?.user.user_id !== user.user_id) {
      this.locks.forEach(listener => listener('revoke'))
      session = Object.freeze({ user, owner: Object.freeze({ userId: user.user_id, source: this.source, epoch: ++this.ownerEpoch }) })
    }
    this.publish({ status: 'signed_in', session, error: '', notice })
  }
  async check() {
    if (this.busy || this.checking || this.fresh) return
    const { generation, signal } = this.begin('checking')
    this.checking = true
    try {
      const user = await this.client.me(signal)
      if (generation === this.generation) this.accept(user, this.logoutRequired && !user ? 'signed_out' : '')
    } catch (error) {
      if (generation !== this.generation) return
      this.publish({ status: this.logoutRequired ? 'logout_failed' : 'service_unavailable', session: this.state.session,
        error: error instanceof AuthError ? error.code : 'unavailable', notice: '' })
    } finally { if (generation === this.generation) this.checking = false }
  }
  async submit(mode: 'login' | 'signup', input: SignupInput) {
    if (this.busy || this.state.status !== 'signed_out') return
    this.busy = true
    this.fresh = false
    const { generation, signal } = this.begin('submitting', true)
    this.announce('changing')
    try {
      const user = await this.client[mode](input, signal)
      if (generation === this.generation) this.accept(user, mode === 'signup' ? 'created' : '')
    } catch (error) {
      if (generation !== this.generation) return
      if (error instanceof AuthError && error.status >= 400 && error.status < 500 && !error.uncertain) {
        this.publish({ status: 'signed_out', session: null, error: error.code, notice: '' })
      } else {
        // The POST may have committed. Never automatically repeat signup/login.
        try {
          const user = await this.client.me(signal)
          if (generation !== this.generation) return
          if (user) this.accept(user)
          else this.publish({ status: 'service_unavailable', session: null, error: 'uncertain', notice: '' })
        } catch {
          if (generation === this.generation) this.publish({ status: 'service_unavailable', session: null, error: 'uncertain', notice: '' })
        }
      }
    } finally { if (generation === this.generation) this.busy = false; this.announce('changed') }
  }
  cancelSubmit() {
    if (this.state.status !== 'submitting') return
    this.begin('service_unavailable', true); this.busy = false
    this.publish({ status: 'service_unavailable', session: null, error: 'uncertain', notice: '' })
    this.announce('changed')
  }
  async logout() {
    if (this.busy || (this.state.status !== 'signed_in' && this.state.status !== 'logout_failed')) return
    this.busy = true; this.logoutRequired = true
    const { generation, signal } = this.begin('signing_out', true)
    this.announce('changing')
    try {
      await this.client.logout(signal)
      if (generation === this.generation) this.accept(null, 'signed_out')
    } catch {
      try {
        const user = await this.client.me(signal)
        if (generation === this.generation) this.accept(user, !user ? 'signed_out' : '')
      } catch {
        if (generation === this.generation) this.publish({ status: 'logout_failed', session: null, error: 'logout_failed', notice: '' })
      }
    } finally { if (generation === this.generation) this.busy = false; this.announce('changed') }
  }
  external(hint: AuthHint) {
    // Cookie changes in another tab invalidate even an in-flight local mutation.
    this.busy = false
    this.begin(this.logoutRequired ? 'logout_failed' : 'checking', true)
    if (hint === 'changed') void this.check()
    else this.publish({ ...this.state, status: this.logoutRequired ? 'logout_failed' : 'service_unavailable', error: 'account_changing' })
  }
  background() {
    if (this.fresh) { this.begin('signed_out', true); return }
    // Background always invalidates in-flight mutations and private authority.
    this.busy = false
    this.begin(this.logoutRequired ? 'logout_failed' : 'checking')
  }
  dispose() { this.generation++; this.request?.abort(); this.busy = false; this.checking = false; this.state = { status: 'checking', session: null, error: '', notice: '' }; this.locks.forEach(listener => listener('revoke')); this.listeners.clear() }
}
