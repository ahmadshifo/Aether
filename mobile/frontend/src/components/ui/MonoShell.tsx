import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { Language, Phase } from '../../voiceSession'
import type { AuthSession } from '../../authController'
import type { LocalHistoryItem } from '../../historyRepository'
import { itemTime } from '../../historyRepository'
import EchoIcon from '../../EchoIcon'
import Modal from '../../Modal'
import { uiCopy } from '../../uiCopy'
import { Brand, Mark, LogoTraceLoader } from './Brand'
import { DynamicButton, HoldToConfirm, TactileButton } from './Buttons'
import { monoCopy } from './monoCopy'

type Page = 'welcome' | 'home' | 'assistant' | 'history' | 'settings' | 'help' | 'connection'
type Props = {
  language: Language; changeLanguage: (language: Language) => void; authorized: boolean; session: AuthSession
  isActive: boolean; starting: boolean; cameraOn: boolean; cameraUnavailable: boolean; phase: Phase
  streamStatus: 'off' | 'connecting' | 'live' | 'failed'; transcript: string; answer: string; answerLanguage: Language; answerIsDemo: boolean
  readSessionId: () => string | undefined; error: string; items: LocalHistoryItem[]; loading: boolean
  videoRef: RefObject<HTMLVideoElement | null>; contentRef: RefObject<HTMLElement | null>; historyButtonRef: RefObject<HTMLButtonElement | null>
  start: () => void; stop: () => void; resume: () => void; replay: () => void; signOut: () => void
  openHistory: () => void; closeHistory: () => void; clearHistory: () => void
  historyView: (onBack: () => void) => ReactNode; toast: ReactNode
}
function readPreferences(key: string): { welcome?: boolean; motion?: boolean; haptics?: boolean } {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {} } catch { return {} }
}
function ScrambleText({ text, enabled, transcript = false }: { text: string; enabled: boolean; transcript?: boolean }) {
  const visual = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = visual.current!; el.textContent = text; el.hidden = true
    if (!enabled || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return
    let step = 0, timer: number | undefined
    // Interim transcripts settle before decorating, with a bounded 640 ms reveal.
    const delay = window.setTimeout(() => { el.hidden = false; timer = window.setInterval(() => {
      step += Math.max(.6, text.length / 16)
      el.textContent = text.split('').map((c, i) => i < step || /[\s\-/?]/.test(c) ? c : 'A7F3#9'[Math.floor(Math.random() * 6)]).join('')
      if (step >= text.length || document.hidden) { el.textContent = text; el.hidden = true; clearInterval(timer) }
    }, 40) }, transcript ? 200 : 0)
    return () => { clearTimeout(delay); clearInterval(timer); el.hidden = true }
  }, [text, enabled, transcript])
  return <span className={transcript ? 'scramble-transcript' : 'scramble-id'}><bdi dir={transcript ? 'auto' : 'ltr'}>{text}</bdi><span ref={visual} className="scramble-visual" dir={transcript ? 'auto' : 'ltr'} aria-hidden="true">{text}</span></span>
}
function Cassette({ language, onReplay, disabled }: { language: Language; onReplay: () => void; disabled: boolean }) {
  const t = monoCopy[language]
  return <div className="cassette-wrap">
    <div className="cassette">
      <button className="cassette-play" aria-label={t.replay} aria-disabled={disabled} onClick={onReplay}><EchoIcon name="volume" size={22} /></button>
      <div className="cassette-window" aria-hidden="true"><span className="reel">✣</span><span className="cassette-track" /><span className="reel">✣</span></div>
      <span className="cassette-label">{uiCopy[language].replay}</span>
    </div>
    <p className="fine-print">{t.audioLimits}</p>
  </div>
}
export default function MonoShell({ videoRef, contentRef, historyButtonRef, ...p }: Props) {
  const t = monoCopy[p.language], u = uiCopy[p.language]
  // Display preferences only: no identity assertion, records or credentials are stored here.
  const preferenceKey = `aether-display-v1:${encodeURIComponent(p.session.owner.source)}:${encodeURIComponent(p.session.owner.userId)}`
  const [preferences, setPreferences] = useState(() => readPreferences(preferenceKey))
  const [page, setPage] = useState<Page>(() => preferences.welcome ? 'home' : 'welcome')
  const [parent, setParent] = useState<'home' | 'settings'>('settings')
  const [selected, setSelected] = useState(0)
  const [prompt, setPrompt] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<'stop' | 'leave' | 'clear' | null>(null)
  const [notice, setNotice] = useState('')
  const [copy, setCopy] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const [ticketId, setTicketId] = useState<string>()
  const [historyVersion, setHistoryVersion] = useState(0)
  const [visible, setVisible] = useState(!document.hidden)
  const [hapticFailed, setHapticFailed] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const copyEpoch = useRef(0)
  const motion = preferences.motion !== false && visible
  const haptics = preferences.haptics === true && typeof navigator.vibrate === 'function' && !hapticFailed
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)) } catch { /* presentation works without persistence */ } }, [preferences, preferenceKey])
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update) }, [])
  useEffect(() => {
    if (p.authorized) return
    let live = true
    copyEpoch.current++
    queueMicrotask(() => { if (live) { setConfirm(null); setPrompt(null); setSelected(0); setNotice(''); setCopy('idle'); setPage(current => current === 'history' ? 'home' : current) } })
    return () => { live = false }
  }, [p.authorized])
  useEffect(() => {
    document.title = `Aether · ${page === 'welcome' ? t.welcome : page === 'connection' ? t.connection : t[page]}`
    heading.current?.focus({ preventScroll: true }); contentRef.current?.scrollTo({ top: 0 })
  }, [page, p.language, t, contentRef])
  useEffect(() => { if (copy !== 'done') return; const timer = window.setTimeout(() => setCopy('idle'), 2000); return () => window.clearTimeout(timer) }, [copy])
  useEffect(() => () => { copyEpoch.current++ }, [])
  function navigate(next: Page) {
    if (page === 'history' && next !== 'history') p.closeHistory()
    if (next === 'history') p.openHistory()
    if (next === 'connection') setParent(page === 'home' ? 'home' : 'settings')
    setNotice(''); setCopy('idle'); setPage(next)
  }
  function start(question: number | null = null) {
    if (!p.authorized) return
    setPrompt(question); navigate('assistant')
    if (!p.isActive) p.start() // Still inside the originating trusted click. Never an effect.
    const id = p.readSessionId(); if (id) setTicketId(id)
  }
  function stop(leave = false) {
    p.stop(); setConfirm(null); setPrompt(null)
    if (leave) navigate('home')
  }
  function clear() {
    p.clearHistory(); setHistoryVersion(value => value + 1); setConfirm(null); setNotice(t.cleared)
  }
  function finishWelcome() { setPreferences(value => ({ ...value, welcome: true })); navigate('home') }
  const streamFailed = p.streamStatus === 'failed' || p.error.startsWith('MediaMTX')
  const cameraLabel = !p.cameraOn ? t.off : streamFailed ? t.cameraPreview : p.streamStatus === 'live' ? t.liveStream : p.streamStatus === 'connecting' ? t.connecting : t.cameraPreview
  const voiceLabel = !p.isActive ? t.off : p.phase === 'paused' ? t.voicePaused : p.phase === 'speaking' || p.phase === 'processing' ? t.voiceResponse : p.starting ? t.starting : p.phase === 'hearing' ? t.hearing : t.listening
  const phaseLabel = p.starting ? t.starting : t[p.phase === 'idle' ? 'ready' : p.phase]
  const answerRecord = p.items.find(item => item.answer === p.answer && item.language === p.answerLanguage)
  const activeNav = page === 'connection' ? parent : page
  const icons = ['eye', 'search', 'history', 'arrow-right', 'sparkles'] as const
  const serviceRows = [
    [t.stream, p.cameraOn ? cameraLabel : import.meta.env.VITE_MEDIAMTX_URL?.trim() ? t.notConnected : t.notConfigured, 'camera'],
    [t.voice, voiceLabel, 'mic'],
    [t.ai, p.answer ? p.answerIsDemo ? t.demoOnly : t.responseReceived : import.meta.env.VITE_AI_API_BASE_URL?.trim() || import.meta.env.VITE_VISION_ASK_URL?.trim() ? t.unverified : t.notConfigured, 'sparkles'],
    [t.memory, t.noDiagnostic, 'history'],
  ] as const
  return <div className={`app-container mono-shell page-${page}`} data-motion={motion ? 'on' : 'off'}>
    <header className="app-header">
      {page === 'assistant' ? <button className="icon-control" aria-label={u.back} onClick={() => p.isActive ? setConfirm('leave') : navigate('home')}><EchoIcon name={p.language === 'ar' ? 'arrow-right' : 'arrow-left'} /></button> : null}
      <Brand />
      <div className="language-switch" role="group" aria-label={p.language === 'ar' ? 'لغة الواجهة' : 'Interface language'}>
        <button className="language-option" aria-pressed={p.language === 'en'} onClick={() => p.changeLanguage('en')}>EN</button>
        <button className="language-option" aria-pressed={p.language === 'ar'} onClick={() => p.changeLanguage('ar')} aria-label="AR">ع</button>
      </div>
    </header>
    <main ref={contentRef} className="app-content" id="main-content">
      {page === 'welcome' && <section className="welcome-screen screen-stack">
        <div className="welcome-intro"><Mark size={130} /><h1 ref={heading} tabIndex={-1}>{t.welcome}</h1><p>{t.welcomeBody}</p></div>
        <div className="permission-list">{[['camera', t.camera, t.cameraWhy], ['mic', t.microphone, t.microphoneWhy]].map(([icon, label, why]) => <article className="permission-card card" key={icon}>
          <span className="icon-tile"><EchoIcon name={icon as 'camera' | 'mic'} /></span><div><h2>{label}</h2><p>{why}</p><p className="fine-print">{t.permission}</p></div>
          <DynamicButton onClick={finishWelcome}>{t.setup}</DynamicButton>
        </article>)}</div>
        <p className="fine-print">{t.permissionNote}</p><TactileButton onClick={finishWelcome} haptics={haptics}>{t.getStarted}<EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} /></TactileButton>
        <p className="safety-note">{t.safety}</p><p className="fine-print">{t.retention}</p>
      </section>}
      {page === 'home' && <section className="home-screen screen-stack">
        <div className="home-greeting"><div><h1 ref={heading} tabIndex={-1}>{t.hello}</h1><p>{t.greeting}</p></div><button className="status-link" aria-label={t.status} onClick={() => navigate('connection')}><span className={`status-dot ${p.streamStatus === 'live' ? 'ok' : ''}`} />{p.streamStatus === 'live' ? t.liveStream : t.connection}</button></div>
        <section className="home-feature card"><div className="feature-heading"><Mark size={92} /><div><p className="eyebrow" dir="ltr">AETHER / 01</p><h2>{t.feature}</h2></div></div><TactileButton height={64} onClick={() => start()} haptics={haptics} aria-label={p.isActive ? t.returnSession : t.startLabel}><EchoIcon name="mic" />{p.isActive ? t.returnSession : t.start}<EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} /></TactileButton></section>
        <section className="questions-section"><div className="section-title"><h2>{t.quick}</h2><span className="eyebrow" aria-hidden="true">01—05</span></div><p className="section-caption">{t.quickHint}</p>
          <div className="playing-cards" role="group" aria-label={t.quick}>{t.questions.map((question, index) => <button key={index} type="button" className={`playing-card ${selected === index ? 'selected' : ''}`} aria-pressed={selected === index} onClick={() => setSelected(index)} style={{ zIndex: selected === index ? 10 : 5 - Math.abs(index - selected), '--offset': index - 2, '--drop': `${Math.abs(index - 2) * 6}px` } as CSSProperties}>
            <span className="card-number" aria-hidden="true"><span>{String(index + 1).padStart(2, '0')}</span><span>Q</span></span><span className="icon-tile"><EchoIcon name={icons[index]} /></span><span className="card-question">{question}</span>
          </button>)}</div>
          <div className="selected-question"><p className="eyebrow">{t.selected}</p><p className="selected-question-text">{t.questions[selected]}</p><button className="primary-button" onClick={() => start(selected)}>{t.ask}<EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} size={18} /></button><p className="fine-print">{t.say}</p></div>
        </section>
        <section className="recent-section"><div className="section-title"><h2>{t.recent}</h2><button className="icon-control" aria-label={t.viewHistory} onClick={() => navigate('history')}><EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} /></button></div>
          {p.loading ? <p role="status">{u.loading}</p> : p.items.length ? <button className="recent-row card" onClick={() => navigate('history')}><span className="icon-tile light"><EchoIcon name="history" /></span><span><time>{itemTime(p.items[0], p.language)}</time><strong dir={p.items[0].language === 'ar' ? 'rtl' : 'ltr'} lang={p.items[0].language}>{p.items[0].question}</strong></span><EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} size={18} /></button> : <div className="empty-recent"><EchoIcon name="history" /><p><strong>{t.noQuestions}</strong><span>{t.noQuestionsBody}</span></p></div>}
        </section>
      </section>}
      {/* Persistent video position: presentation navigation never detaches its srcObject. */}
      <section className="assistant-screen screen-stack" hidden={page !== 'assistant'} aria-label={t.assistant}>
        <h1 className="sr-only" ref={page === 'assistant' ? heading : undefined} tabIndex={-1}>{t.assistant}</h1>
        <div className={`camera-stage ${p.cameraOn ? 'has-video' : ''}`} hidden={!p.isActive}>
          <video ref={videoRef} autoPlay muted playsInline className={`stage-video ${p.cameraOn ? 'is-visible' : ''}`} aria-label={t.cameraPreview} />
          {!p.cameraOn && <div className="voice-only-stage"><EchoIcon name={p.starting ? 'camera' : 'camera-off'} size={36} /><p>{p.starting ? t.preparing : t.voiceOnly}</p></div>}
          <div className="stage-top-overlay"><span className="stage-chip"><span className={`live-dot ${p.streamStatus === 'live' ? 'live' : ''}`} />{cameraLabel}</span><span className="stage-chip">{voiceLabel}</span></div>
        </div>
        {!p.isActive && <button className="assistant-idle" aria-label={t.startLabel} onClick={() => start(prompt)}><Mark size={150} /><strong>{t.tap}</strong><span>{t.idleHint}</span></button>}
        {p.isActive && <div className="phase-row"><div role="status" aria-live="polite" aria-atomic="true"><LogoTraceLoader active={p.starting || p.phase === 'processing'} /><span>{phaseLabel}</span></div>{p.phase === 'paused' && <button className="primary-button" onClick={p.resume}>{t.resume}</button>}</div>}
        {prompt !== null && <div className="prompt-note"><p className="eyebrow">{t.selected}</p><p>{t.questions[prompt]}</p><span className="fine-print">{t.say}</span></div>}
        {p.isActive && p.phase === 'hearing' && p.transcript.trim() && <section className="transcript-card card"><p className="eyebrow">{t.transcript}</p><p dir="auto"><ScrambleText text={p.transcript} enabled={motion && p.language === 'en'} transcript /></p></section>}
        {p.isActive && p.answer && <section className="receipt-printer" aria-label={t.answer}>
          <div className="printer-slot" aria-hidden="true" /><div className="receipt-paper" key={answerRecord?.id ?? p.answer}>
            <header><span className="eyebrow">AETHER · {t.answer}</span>{answerRecord && <time>{itemTime(answerRecord, p.language)}</time>}</header>
            {p.answerIsDemo && <p className="demo-note">{t.demo}</p>}
            <p className="receipt-answer" lang={p.answerLanguage} dir={p.answerLanguage === 'ar' ? 'rtl' : 'ltr'}>{p.answer}</p>
            <footer><span>{t.evidence}</span><bdi>{p.answerLanguage.toUpperCase()}</bdi></footer>
          </div><Cassette language={p.language} onReplay={p.replay} disabled={p.answerLanguage !== p.language} />
        </section>}
        {p.error && <div role="alert" className="error-alert"><strong>{u.errorTitle}</strong><p>{u.errorHint}</p><p dir="auto">{p.error}</p>{!p.isActive && <button className="text-button" onClick={() => start(prompt)}>{u.retry}</button>}</div>}
      </section>
      <div key={historyVersion} hidden={page !== 'history'}>{p.historyView(() => navigate('home'))}</div>
      {page === 'settings' && <section className="settings-screen screen-stack"><div className="page-heading"><p className="eyebrow">AETHER / {t.settings}</p><h1 ref={heading} tabIndex={-1}>{t.settings}</h1></div>
        <section><h2 className="section-heading">{t.voice}</h2><div className="settings-card card">
          <label className="setting-select"><strong>{t.speed}</strong><select disabled aria-describedby="speed-note" defaultValue="default"><option value="default">{t.speedValue}</option><option>{t.slow}</option><option>{t.normal}</option><option>{t.fast}</option></select><span id="speed-note" className="fine-print">{t.voiceIntegration}</span></label>
          <div className="setting-row"><div><strong>{t.aloud}</strong><p>{t.aloudNote}</p></div><button className="switch" role="switch" aria-checked="true" disabled aria-label={t.aloud} /></div>
          <div className="setting-row"><div><strong>{t.vibrate}</strong><p>{typeof navigator.vibrate !== 'function' || hapticFailed ? t.hapticsUnavailable : t.vibrateNote}</p></div><button className="switch" role="switch" aria-checked={preferences.haptics === true} disabled={typeof navigator.vibrate !== 'function' || hapticFailed} aria-label={t.vibrate} onClick={() => { const next = !preferences.haptics; setPreferences(value => ({ ...value, haptics: next })); if (next) { try { if (!navigator.vibrate(15)) setHapticFailed(true) } catch { setHapticFailed(true) } } }} /></div>
          <div className="setting-row"><div><strong>{t.motion}</strong><p>{t.motionNote}</p></div><button className="switch" role="switch" aria-checked={preferences.motion !== false} aria-label={t.motion} onClick={() => setPreferences(value => ({ ...value, motion: value.motion === false }))} /></div>
          <div className="setting-row"><div><strong>{t.warning}</strong><p>{t.warningNote}</p></div><button className="switch" role="switch" aria-checked="false" disabled aria-label={t.warning} /></div>
        </div></section>
        <section><h2 className="section-heading">{t.local}</h2><div className="settings-card card"><p>{t.retention}</p><HoldToConfirm label={t.holdClear} holdingLabel={t.holding} releaseLabel={t.releaseClear} optionsLabel={t.clearOptions} onConfirm={clear} onOptions={() => setConfirm('clear')} disabled={!p.items.length || p.loading} soft haptics={haptics} /><p className="fine-print">{t.clearHint}</p></div></section>
        <section><h2 className="section-heading">{t.support}</h2><div className="link-list card">{(['connection', 'help'] as const).map(key => <button key={key} onClick={() => navigate(key)}><EchoIcon name={key === 'connection' ? 'radio' : 'circle-help'} /><span>{key === 'help' ? t.how : t.connection}</span><EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} size={18} /></button>)}</div></section>
        <section><h2 className="section-heading">{t.account}</h2><div className="account-card card"><p className="account-name" dir="auto">{p.session.user.name}</p><bdi dir="ltr">{p.session.user.email}</bdi><p className="fine-print">{t.accountNote}</p><button className="text-button danger-text" onClick={p.signOut}><EchoIcon name="logout" />{t.signOut}</button></div></section>
      </section>}
      {page === 'help' && <section className="help-screen screen-stack"><div className="page-heading"><p className="eyebrow">AETHER / {t.help}</p><h1 ref={heading} tabIndex={-1}>{t.how}</h1><p>{t.helpIntro}</p></div><ol className="help-steps">{t.steps.map(([title, body], index) => <li className="card" key={index}><span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h2>{title}</h2><p>{body}</p></div></li>)}</ol><section><h2>{t.tryAsking}</h2><div className="stamps"><div className="stamp">{t.questions[1]}</div><div className="stamp" dir="rtl" lang="ar">ماذا يوجد أمامي؟</div><div className="stamp">{t.questions[3]}</div></div></section><p className="safety-note"><EchoIcon name="circle-help" />{t.safety}</p></section>}
      {page === 'connection' && <section className="connection-screen screen-stack"><div className="section-title"><h1 ref={heading} tabIndex={-1}>{t.connection}</h1><DynamicButton onClick={() => setNotice(t.checked)}><LogoTraceLoader active={false} />{t.check}</DynamicButton></div>
        <article className="session-ticket card"><div className="ticket-main"><p className="eyebrow">{t.ticket}</p>{ticketId ? <><ScrambleText text={ticketId} enabled={motion && p.language === 'en'} /><p className="fine-print">{p.isActive ? t.startedUnknown : t.sessionEnded}</p></> : <><h2>{t.noSession}</h2><p>{t.sessionHint}</p></>}<span className="ticket-perforation" aria-hidden="true" /><p className="fine-print">{t.helper}</p></div><div className="ticket-stub"><Mark size={32} /><span>{p.streamStatus === 'live' ? t.liveStream : t.idle}</span></div></article>
        <DynamicButton disabled={!ticketId || copy === 'busy'} className={copy === 'done' ? 'done' : ''} onClick={async () => { const epoch = ++copyEpoch.current; setCopy('busy'); try { if (!navigator.clipboard?.writeText || !ticketId) throw Error(); await navigator.clipboard.writeText(ticketId); if (epoch === copyEpoch.current) setCopy('done') } catch { if (epoch === copyEpoch.current) setCopy('failed') } }}><EchoIcon name={copy === 'done' ? 'check' : 'copy'} size={18} />{copy === 'done' ? t.copied : copy === 'busy' ? t.copying : t.copyId}</DynamicButton>
        {copy === 'failed' && <p role="status" className="storage-alert">{t.copyFallback}</p>}
        <div className="services card">{serviceRows.map(([label, value, icon]) => <div className="service-row" key={label}><EchoIcon name={icon} /><span>{label}</span><strong>{value}</strong></div>)}</div><p className="fine-print">{t.diagnostic}</p>
      </section>}
      {notice && <p role="status" className="storage-alert">{notice}</p>}
    </main>
    {page === 'assistant' ? <footer className="assistant-actions">{p.isActive ? <HoldToConfirm label={t.holdStop} holdingLabel={t.holding} releaseLabel={t.releaseStop} optionsLabel={t.stopOptions} onConfirm={() => stop()} onOptions={() => setConfirm('stop')} haptics={haptics} /> : <TactileButton height={92} aria-label={t.startLabel} onClick={() => start(prompt)} haptics={haptics}><span className="start-badge"><EchoIcon name="camera" size={28} /></span><span><strong>{t.start}</strong><small>{t.startHint}</small></span><EchoIcon name={p.language === 'ar' ? 'arrow-left' : 'arrow-right'} /></TactileButton>}</footer>
      : page !== 'welcome' && <nav className="tab-bar" aria-label={t.navigation}>
        {(['home', 'history', 'assistant', 'help', 'settings'] as const).map(destination => destination === 'assistant' ? <button className="assistant-tab" key={destination} onClick={() => start()} aria-label={p.isActive ? t.returnSession : `${t.assistant}: ${t.startLabel}`}><span><Mark size={66} /></span><strong>{t.assistant}</strong></button>
          : <button key={destination} ref={destination === 'history' ? historyButtonRef : undefined} aria-current={activeNav === destination ? 'page' : undefined} onClick={() => navigate(destination)}><EchoIcon name={destination === 'home' ? 'home' : destination === 'history' ? 'history' : destination === 'help' ? 'circle-help' : 'settings'} size={22} /><span>{t[destination]}</span></button>)}
      </nav>}
    {p.toast}
    {p.authorized && confirm && <Modal title={confirm === 'clear' ? t.clearTitle : confirm === 'leave' ? t.leaveTitle : t.stopTitle} closeLabel={t.close} onClose={() => setConfirm(null)}><p>{confirm === 'clear' ? t.clearBody : t.stopBody}</p><div className="confirmation-actions"><button className="text-button" onClick={() => setConfirm(null)}>{t.cancel}</button><button className="danger-button" onClick={() => confirm === 'clear' ? clear() : stop(confirm === 'leave')}>{confirm === 'clear' ? t.clear : confirm === 'leave' ? t.leave : t.stop}</button></div></Modal>}
  </div>
}
