import { useEffect, useRef, useState } from 'react'
import type { Language } from './voiceSession'
import type { AuthController, AuthState } from './authController'
import { validateAuth } from './authClient'
import { authCopy } from './authCopy'
import EchoIcon from './EchoIcon'
import { Brand, Mark, LogoTraceLoader } from './components/ui/Brand'
import { TactileButton } from './components/ui/Buttons'
import { monoCopy } from './components/ui/monoCopy'

export default function AuthScreen({ state, controller, language, setLanguage }: {
  state: AuthState; controller: AuthController; language: Language; setLanguage: (language: Language) => void
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [landing, setLanding] = useState(true)
  const [show, setShow] = useState(false)
  const [validation, setValidation] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const message = useRef<HTMLParagraphElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const t = authCopy[language]
  const m = monoCopy[language]
  const error = validation || state.error
  const errorText = t.errors[error as keyof typeof t.errors] ?? t.errors.unavailable
  const pending = state.status === 'submitting'
  const showForm = state.status === 'signed_out' || pending
  useEffect(() => { if (error) message.current?.focus() }, [error])
  useEffect(() => { title.current?.focus() }, [mode, showForm, landing])
  useEffect(() => { document.title = `Aether · ${showForm ? landing ? t.login : mode === 'signup' ? t.signup : t.login : t.locked}` }, [showForm, landing, mode, t])
  function switchMode() { form.current?.reset(); controller.clearError(); setShow(false); setValidation(''); setMode(mode === 'login' ? 'signup' : 'login') }
  return <div className="app-shell auth-shell" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <div className="auth-container">
      <header className="app-header">
        <Brand />
        <div className="language-switch" role="group" aria-label={t.language}>
          <span className={`language-active ${language === 'ar' ? 'is-ar' : ''}`} aria-hidden="true" />
          <button className="language-option" type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
          <button className="language-option" type="button" aria-label="AR" aria-pressed={language === 'ar'} onClick={() => setLanguage('ar')}>ع</button>
        </div>
      </header>
      <main className={`auth-content ${landing && showForm ? 'auth-landing' : ''}`}>
        {showForm && !landing && <button className="text-button auth-back" disabled={pending} onClick={() => { form.current?.reset(); controller.clearError(); setValidation(''); setShow(false); setLanding(true) }}><EchoIcon name={language === 'ar' ? 'arrow-right' : 'arrow-left'} />{m.back}</button>}
        <Mark size={landing && showForm ? 180 : 64} />
        <h1 ref={title} tabIndex={-1} className={landing && showForm ? 'wordmark' : ''} dir={landing && showForm ? 'ltr' : undefined}>{showForm ? landing ? 'Aether' : (mode === 'signup' ? t.signup : t.welcome) : t.locked}</h1>
        {showForm && <p className="auth-intro">{landing ? m.tagline : t.intro}</p>}
        {state.notice && <p role="status" className="auth-notice">{t[state.notice as 'created' | 'signed_out']}</p>}
        {error && <p ref={message} id="auth-error" tabIndex={-1} role="alert" className="auth-error">{errorText}</p>}
        {showForm && landing ? <div className="landing-actions"><TactileButton height={64} onClick={() => { setMode('login'); setLanding(false) }}>{t.login}<EchoIcon name={language === 'ar' ? 'arrow-left' : 'arrow-right'} /></TactileButton><button className="secondary-button signup-button" onClick={() => { setMode('signup'); setLanding(false) }}>{m.signup}</button><p className="accessible-note"><EchoIcon name="audio-lines" size={18} />{m.accessible}</p></div> : showForm ? <form ref={form} noValidate aria-busy={pending} onSubmit={event => {
          event.preventDefault()
          if (pending) return
          const data = new FormData(event.currentTarget)
          const input = { name: String(data.get('name') ?? ''), email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') }
          const invalid = validateAuth(mode, input, String(data.get('confirmation') ?? ''))
          setValidation(invalid)
          if (invalid) { message.current?.focus(); return }
          void controller.submit(mode, input)
          // No credential state, persistence, logging or retained password after a request.
          event.currentTarget.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach(field => { field.value = '' })
        }}>
          <fieldset disabled={pending}>
            {mode === 'signup' && <label htmlFor="auth-name">{t.name}<input id="auth-name" name="name" required autoComplete="name" dir="auto" aria-invalid={error === 'invalid_name'} aria-describedby={error ? 'auth-error' : undefined} /></label>}
            <label htmlFor="auth-email">{t.email}<input id="auth-email" name="email" required type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" aria-invalid={error === 'invalid_email'} aria-describedby={error ? 'auth-error' : undefined} /></label>
            <label htmlFor="auth-password">{t.password}<input id="auth-password" name="password" required data-secret type={show ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="auto" aria-invalid={error === 'weak_password' || error === 'password_required'} aria-describedby={error ? 'auth-error' : undefined} /></label>
            {mode === 'signup' && <label htmlFor="auth-confirm">{t.confirm}<input id="auth-confirm" name="confirmation" required data-secret type={show ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="auto" aria-invalid={error === 'mismatch'} aria-describedby={error ? 'auth-error' : undefined} /></label>}
            <button className="auth-show text-button" type="button" aria-pressed={show} onClick={() => setShow(value => !value)}>{show ? t.hide : t.show}</button>
            <TactileButton className="auth-submit" type="submit" disabled={pending}>{pending ? <><LogoTraceLoader active />{t.pending}</> : mode === 'signup' ? t.signup : t.login}</TactileButton>
          </fieldset>
          {pending ? <button type="button" className="text-button auth-switch" onClick={() => controller.cancelSubmit()}>{t.cancel}</button>
            : <button type="button" className="text-button auth-switch" onClick={switchMode}>{mode === 'login' ? t.newAccount : t.existing}</button>}
        </form> : <div className="auth-status">
          {(state.status === 'checking' || state.status === 'signing_out') ? <p role="status"><EchoIcon name="loader" className="spin-icon" /> {state.status === 'checking' ? t.checking : t.signingOut}</p>
            : <>{state.status === 'logout_failed' && <button className="auth-submit" onClick={() => void controller.logout()}>{t.retryLogout}</button>}
              <button className="text-button" onClick={() => void controller.check()}>{t.retry}</button></>}
        </div>}
        {!(showForm && landing) && <p className="auth-privacy">{t.privacy}</p>}
      </main>
    </div>
  </div>
}
