import { useEffect, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import type { Language } from './voiceSession'
import { createAuthClient } from './authClient'
import { AuthController } from './authController'
import type { AuthHint, AuthSession } from './authController'
import AuthScreen from './AuthScreen'
import { createHistoryRepository } from './useHistory'
import type { LocalHistoryRepository } from './historyRepository'

const HINT_KEY = 'echosight-auth-event-v1'
function authEvents() {
  let channel: BroadcastChannel | null = null
  return {
    send(type: AuthHint) {
      const hint = { type, nonce: crypto.randomUUID() }
      channel?.postMessage(hint)
      try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)) } catch { /* foreground checks remain available */ }
    },
    connect(receive: (value: unknown) => void) {
      try { channel = new BroadcastChannel(HINT_KEY); channel.onmessage = event => receive(event.data) } catch { /* storage event fallback */ }
      return () => { channel?.close(); channel = null }
    },
  }
}
export type AccountProps = {
  auth: AuthController; session: AuthSession; authorized: boolean; repository: LocalHistoryRepository
  language: Language; setLanguage: (language: Language) => void
}
function Account({ auth, session, authorized, language, setLanguage, children }: Omit<AccountProps, 'repository'> & { children: (props: AccountProps) => ReactNode }) {
  const [repository, setRepository] = useState<LocalHistoryRepository | null>(null)
  useEffect(() => {
    const next = createHistoryRepository(session.owner)
    let live = true
    queueMicrotask(() => { if (live) setRepository(next) })
    const remove = auth.onLock(reason => { if (reason === 'revoke') next.dispose() })
    return () => { live = false; remove(); next.dispose() }
  }, [session.owner, auth])
  return repository ? children({ auth, session, authorized, repository, language, setLanguage }) : null
}
export default function AuthBoundary({ children }: { children: (props: AccountProps) => ReactNode }) {
  const [bridge] = useState(authEvents)
  const [language, setLanguage] = useState<Language>('en')
  const [controller] = useState(() => new AuthController(createAuthClient(), bridge.send))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr' }, [language])
  useEffect(() => {
    let lastHint = ''
    const receive = (value: unknown) => {
      const hint = value as { type?: AuthHint; nonce?: string } | null
      if (!hint || (hint.type !== 'changing' && hint.type !== 'changed') || typeof hint.nonce !== 'string' || hint.nonce === lastHint) return
      lastHint = hint.nonce
      // Hints confer no authority. Synchronously hide private DOM before /me.
      flushSync(() => controller.external(hint.type!))
    }
    const disconnect = bridge.connect(receive)
    const storage = (event: StorageEvent) => { if (event.key === HINT_KEY && event.newValue) { try { receive(JSON.parse(event.newValue)) } catch { /* untrusted hint */ } } }
    const foreground = () => { if (document.visibilityState === 'visible') void controller.check() }
    const background = () => { flushSync(() => controller.background()) }
    const visibility = () => { if (document.visibilityState === 'hidden') background(); else foreground() }
    window.addEventListener('storage', storage)
    window.addEventListener('pageshow', foreground)
    window.addEventListener('pagehide', background)
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', visibility)
    void controller.check()
    return () => {
      controller.dispose(); disconnect()
      window.removeEventListener('storage', storage); window.removeEventListener('pageshow', foreground)
      window.removeEventListener('pagehide', background); window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [controller, bridge])
  const authorized = state.status === 'signed_in'
  return <>
    {state.session && <Account key={state.session.owner.epoch} auth={controller} session={state.session} authorized={authorized} language={language} setLanguage={setLanguage}>{children}</Account>}
    {!authorized && <AuthScreen state={state} controller={controller} language={language} setLanguage={setLanguage} />}
  </>
}
