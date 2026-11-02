import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import HistoryPage from './HistoryPage'
import EchoIcon from './EchoIcon'
import { VoiceSession, type Language, type Phase } from './voiceSession'
import { WhipPublisher } from './whipPublisher'
import Modal from './Modal'
import { uiCopy } from './uiCopy'
import { useHistory } from './useHistory'
import { SnapshotBridge } from './snapshotBridge'

const words = {
  en: {
    subtitle: 'Your AI visual assistant', camera: 'Live camera', on: 'Live', off: 'Off',
    ready: 'Ready to help', listening: 'Listening…', hearing: 'I hear you…',
    processing: 'Thinking…', speaking: 'Speaking…', paused: 'Session paused',
    welcomeHint: 'Tap Start to open the camera and microphone together.',
    voiceOnly: 'Camera unavailable — voice only',
    voiceOnlyHint: 'The camera is off. You can still ask questions by voice.',
    latest: 'Latest answer', connected: 'Voice assistant', demo: 'Demo',
    history: 'History', replay: 'Replay answer', language: 'Interface language',
    home: 'EchoSight home', start: 'Start', starting: 'Starting…', stop: 'Stop',
    startLabel: 'Start camera and microphone', stopLabel: 'Stop session',
    transcript: 'You said', cameraFailed: 'Camera unavailable. Voice-only mode is available.',
    controls: 'Assistant controls', collapse: 'Collapse answer', expand: 'Expand answer',
    resume: 'Resume session',
  },
  ar: {
    subtitle: 'مساعدك البصري الذكي', camera: 'الكاميرا المباشرة', on: 'مباشر', off: 'متوقفة',
    ready: 'جاهز للمساعدة', listening: 'أستمع إليك…', hearing: 'أسمعك…',
    processing: 'أفكّر…', speaking: 'أنطق الإجابة…', paused: 'الجلسة متوقفة مؤقتًا',
    welcomeHint: 'اضغط ابدأ لتشغيل الكاميرا والميكروفون معًا.',
    voiceOnly: 'الكاميرا غير متاحة — وضع الصوت فقط',
    voiceOnlyHint: 'الكاميرا متوقفة. لا يزال بإمكانك طرح أسئلة صوتية.',
    latest: 'آخر إجابة', connected: 'المساعد الصوتي', demo: 'تجريبي',
    history: 'السجل', replay: 'إعادة سماع الإجابة', language: 'لغة الواجهة',
    home: 'الصفحة الرئيسية لإيكوسايت', start: 'ابدأ', starting: 'جارٍ البدء…', stop: 'إيقاف',
    startLabel: 'تشغيل الكاميرا والميكروفون', stopLabel: 'إنهاء الجلسة',
    transcript: 'ما قلته', cameraFailed: 'الكاميرا غير متاحة. يمكن استخدام الوضع الصوتي فقط.',
    controls: 'أدوات المساعد', collapse: 'طي الإجابة', expand: 'عرض الإجابة',
    resume: 'استئناف الجلسة',
  },
}

async function captureFrame(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video || !video.srcObject || !video.videoWidth || !video.videoHeight) return null
  const width = Math.min(1024, video.videoWidth)
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  // Never mirror rear camera footage.
  context.drawImage(video, 0, 0, width, height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7))
}

const HistoryPreview = import.meta.env.DEV ? lazy(() => import('./HistoryPreview')) : null
export default function App() {
  if (HistoryPreview && new URLSearchParams(location.search).get('preview') === 'history') {
    return <Suspense fallback={null}><HistoryPreview /></Suspense>
  }
  return <AssistantApp />
}

function AssistantApp() {
  const [language, setLanguage] = useState<Language>('en')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessionOn, setSessionOn] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [streamStatus, setStreamStatus] = useState<'off' | 'connecting' | 'live' | 'failed'>('off')
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerLanguage, setAnswerLanguage] = useState<Language>('en')
  const [answerIsDemo, setAnswerIsDemo] = useState(false)
  const [answerCollapsed, setAnswerCollapsed] = useState(true)
  const [error, setError] = useState('')
  const history = useHistory()
  const repository = history.repository
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [toast, setToast] = useState('')
  const snapshotRef = useRef(new SnapshotBridge())
  const languageRef = useRef(language)
  const transcriptRef = useRef('')
  const historyOpenRef = useRef(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLElement>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const publisherRef = useRef<WhipPublisher | null>(null)
  const cameraRequestRef = useRef(0)
  const sessionAttemptRef = useRef(0)
  const requestedSessionRef = useRef(false)
  const voiceRef = useRef<VoiceSession | null>(null)
  const t = words[language]
  const u = uiCopy[language]

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function stopCamera() {
    publisherRef.current?.stop()
    publisherRef.current = null
    cameraRequestRef.current += 1
    cameraRef.current?.getTracks().forEach(track => track.stop())
    cameraRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
    setStreamStatus('off')
  }

  // Existing video-only camera acquisition, shared by the single session button.
  // The voice session separately owns microphone acquisition/recognition, to
  // avoid competing microphone tracks on iPhone.
  async function startCamera(): Promise<boolean> {
    const request = ++cameraRequestRef.current
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15 } },
        audio: false,
      })
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return false
      }
      cameraRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try { await videoRef.current.play() } catch { /* inline video still has a live stream */ }
      }
      setCameraOn(true)
      // Publish the existing camera track: no second camera or mic acquisition.
      const mediaBase = import.meta.env.VITE_MEDIAMTX_URL?.trim().replace(/\/$/, '')
      if (mediaBase) {
        const streamSessionId = voiceRef.current?.sessionIdForStreaming ?? crypto.randomUUID()
        const publisher = new WhipPublisher()
        publisherRef.current = publisher
        setStreamStatus('connecting')
        void publisher.start(stream, `${mediaBase}/live/${streamSessionId}/whip`).then(() => {
          if (publisherRef.current === publisher) setStreamStatus('live')
        }).catch((reason: unknown) => {
          if (publisherRef.current !== publisher) return
          publisherRef.current = null
          setStreamStatus('failed')
          setError(`MediaMTX streaming failed: ${reason instanceof Error ? reason.message : String(reason)}`)
        })
      } else {
        setStreamStatus('failed')
        setError('MediaMTX URL missing: set VITE_MEDIAMTX_URL in .env.local')
      }
      return true
    } catch {
      if (request === cameraRequestRef.current) setCameraOn(false)
      return false
    }
  }

  useEffect(() => {
    const snapshots = snapshotRef.current
    const controller = new VoiceSession({
      onSession: (isOn) => {
        setSessionOn(isOn)
        if (!isOn) snapshotRef.current.cancel()
        // A denied/failed microphone must never leave the camera recording.
        if (!isOn && requestedSessionRef.current) {
          requestedSessionRef.current = false
          sessionAttemptRef.current += 1
          stopCamera()
          setStarting(false)
        }
      },
      onPhase: (next) => {
        if (next === 'paused') snapshotRef.current.cancel()
        else if (next !== 'processing') snapshotRef.current.discard()
        setPhase(next)
      },
      onTranscript: (text) => { transcriptRef.current = text; setTranscript(text) },
      onError: (text) => { if (text) snapshotRef.current.discard(); setError(text) },
      getFrame: () => snapshotRef.current.capture(
        () => captureFrame(videoRef.current), controller.sessionIdForStreaming,
        transcriptRef.current, languageRef.current,
      ),
      onAnswer: (item) => {
        setAnswer(item.answer)
        setAnswerLanguage(item.language)
        setAnswerIsDemo(Boolean(item.demo))
        setAnswerCollapsed(true)
        repository.upsert(snapshotRef.current.consume(item, controller.sessionIdForStreaming))
      },
    })
    voiceRef.current = controller
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') snapshotRef.current.cancel()
      controller.onVisibilityChange()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      snapshots.cancel()
      document.removeEventListener('visibilitychange', handleVisibility)
      controller.stop()
      publisherRef.current?.stop()
      publisherRef.current = null
      if (voiceRef.current === controller) voiceRef.current = null
      requestedSessionRef.current = false
      sessionAttemptRef.current += 1
      cameraRequestRef.current += 1
      cameraRef.current?.getTracks().forEach(track => track.stop())
      cameraRef.current = null
    }
  }, [repository])

  async function startSession() {
    if (sessionOn || starting || requestedSessionRef.current || !voiceRef.current) return
    const attempt = ++sessionAttemptRef.current
    requestedSessionRef.current = true
    setStarting(true)
    setCameraUnavailable(false)
    setError('')
    setAnswer('')
    snapshotRef.current.reset()

    // Both operations start from this one user tap. Browser speech recognition
    // and camera may still show separate OS permission prompts.
    void voiceRef.current.start(language)
    const cameraReady = await startCamera()
    if (attempt !== sessionAttemptRef.current) return

    if (!voiceRef.current?.isActive) {
      stopCamera()
      setStarting(false)
      return
    }
    setCameraUnavailable(!cameraReady)
    setStarting(false)
  }

  function stopSession() {
    snapshotRef.current.cancel()
    requestedSessionRef.current = false
    sessionAttemptRef.current += 1
    voiceRef.current?.stop()
    stopCamera()
    setCameraUnavailable(false)
    setStarting(false)
  }

  function toggleSession() {
    if (starting) return
    if (sessionOn) stopSession()
    else {
      if (historyOpenRef.current) closeHistory()
      void startSession()
    }
  }

  function changeLanguage(next: Language) {
    if (next === language) return
    snapshotRef.current.reset()
    languageRef.current = next
    setLanguage(next)
    voiceRef.current?.changeLanguage(next)
    // The new persistent header is usable on History. Keep that screen's pause
    // after the public language setter schedules recognition for the new locale.
    if (historyOpenRef.current) {
      snapshotRef.current.cancel()
      voiceRef.current?.pause()
    }
  }

  function openHistory() {
    if (historyOpenRef.current) return
    historyOpenRef.current = true
    snapshotRef.current.cancel()
    voiceRef.current?.pause()
    setHistoryOpen(true)
  }
  function closeHistory() {
    historyOpenRef.current = false
    setHistoryOpen(false)
    voiceRef.current?.resume()
    contentRef.current?.scrollTo({ top: 0 })
    historyButtonRef.current?.focus()
  }

  const isActive = sessionOn || starting
  const streamFailed = streamStatus === 'failed' || error.startsWith('MediaMTX')
  const cameraLabel = !cameraOn ? t.off : streamFailed ? u.streamIssue : streamStatus === 'connecting' ? u.streamConnecting : t.on
  const showingTranscript = isActive && phase === 'hearing' && Boolean(transcript.trim())
  const showStageCard = isActive && (showingTranscript || Boolean(answer))
  const status = starting ? t.starting : t[phase === 'idle' ? 'ready' : phase]
  const statusIcon = starting || phase === 'processing' ? 'loader'
    : phase === 'speaking' ? 'volume'
    : phase === 'listening' || phase === 'hearing' ? 'audio-lines'
    : phase === 'paused' ? 'mic-off' : 'sparkles'

  return (
    <div className="app-shell" dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
      <div className={`app-container ${isActive ? 'is-active' : ''}`}>
        <header className="app-header">
          <div className="brand" aria-label={t.home}>
            <span className="brand-mark"><EchoIcon name="eye" size={25} /></span>
            <span className="brand-copy"><strong>EchoSight</strong><span>{t.subtitle}</span></span>
          </div>
          <div className="language-switch" role="group" aria-label={t.language}>
            <span className={`language-active ${language === 'ar' ? 'is-ar' : ''}`} aria-hidden="true" />
            <button type="button" className="language-option" aria-pressed={language === 'en'} onClick={() => changeLanguage('en')}>EN</button>
            <button type="button" className="language-option" aria-pressed={language === 'ar'} onClick={() => changeLanguage('ar')}>AR</button>
          </div>
        </header>

        <main ref={contentRef} className="app-content" id="main-content">
          <div className="home-screen" hidden={historyOpen}>
          <section className={`camera-stage ${cameraOn ? 'has-video' : ''}`} aria-label={t.camera}>
            <video
              ref={videoRef} autoPlay muted playsInline aria-label={t.camera}
              className={`stage-video ${cameraOn ? 'is-visible' : ''}`}
            />

            {!isActive && (
              <div className="welcome-stage">
                <span className="welcome-eye" aria-hidden="true">
                  <span className="welcome-ring" />
                  <span className="welcome-ring ring-two" />
                  <EchoIcon name="eye" size={46} />
                </span>
                <h1>{t.ready}</h1>
                <p>{t.welcomeHint}</p>
              </div>
            )}

            {isActive && !cameraOn && (
              <div className="voice-only-stage" aria-hidden="true">
                <EchoIcon name="audio-lines" size={44} />
                <p>{starting ? u.preparing : t.voiceOnlyHint}</p>
              </div>
            )}

            {/* One top overlay: the camera chip never changes its location. */}
            <div className="stage-top-overlay">
              <span className={`stage-chip ${cameraOn && streamStatus === 'live' && !streamFailed ? 'is-live' : ''}`} aria-label={`${t.camera}: ${cameraLabel}`}>
                <span className="live-dot" aria-hidden="true" />
                {cameraLabel}
              </span>

              {isActive && (
                <div className="stage-status-group">
                  <div className={`stage-status phase-${phase}`} role="status" aria-live="polite" aria-atomic="true">
                    {phase === 'hearing' ? (
                      <span className="equalizer" aria-hidden="true"><i /><i /><i /></span>
                    ) : phase === 'listening' ? (
                      <span className="listening-dot" aria-hidden="true" />
                    ) : (
                      <EchoIcon
                        name={statusIcon}
                        size={17}
                        className={starting || phase === 'processing' ? 'spin-icon' : ''}
                      />
                    )}
                    <span className="stage-status-label">{status}</span>
                  </div>
                  {phase === 'paused' && (
                    <button type="button" className="resume-button" onClick={() => voiceRef.current?.resume()}>
                      {t.resume}
                    </button>
                  )}
                </div>
              )}
            </div>

            {isActive && !cameraOn && cameraUnavailable && (
              <span className="voice-only-chip">{t.voiceOnly}</span>
            )}

            {/* No answer is shown in idle. While hearing, show the live transcript instead. */}
            {showStageCard && (
              <div className={`stage-bottom-overlay ${answerCollapsed ? '' : 'is-expanded'}`}>
                <section
                  className={`answer-overlay ${answerCollapsed ? 'is-collapsed' : 'is-expanded'} ${showingTranscript ? 'is-transcript' : ''}`}
                  aria-label={showingTranscript ? t.transcript : t.latest}
                >
                  <div className="answer-heading">
                    <span className="answer-heading-icon"><EchoIcon name={showingTranscript ? 'audio-lines' : 'sparkles'} size={17} /></span>
                    <span className="answer-title">{showingTranscript ? t.transcript : t.latest}</span>
                    {!showingTranscript && answerIsDemo && <span className="demo-badge">{t.demo}</span>}
                    <button
                      type="button" className="answer-chevron-control"
                      onClick={() => setAnswerCollapsed(v => !v)}
                      aria-expanded={!answerCollapsed}
                      aria-label={answerCollapsed ? t.expand : t.collapse}
                    >
                      <svg className="answer-chevron" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {!showingTranscript && (
                      <button type="button" className="replay-control" aria-label={t.replay} aria-disabled={answerLanguage !== language} onClick={() => {
                        if (answerLanguage !== language) setToast(u.replayLanguage)
                        else voiceRef.current?.replay(answer)
                      }}>
                        <EchoIcon name="volume" size={21} />
                      </button>
                    )}
                  </div>
                  <p className="answer-text" aria-live={showingTranscript ? 'off' : 'polite'} lang={showingTranscript ? language : answerLanguage} dir={(showingTranscript ? language : answerLanguage) === 'ar' ? 'rtl' : 'ltr'} tabIndex={answerCollapsed ? undefined : 0}>
                    {showingTranscript ? transcript : answer}
                  </p>
                </section>
              </div>
            )}
          </section>
          {error && <div role="alert" className="error-alert"><strong>{u.errorTitle}</strong><p>{u.errorHint}</p><p dir="auto">{error}</p>
            {!isActive && <button className="text-button" onClick={() => void startSession()}>{u.retry}</button>}
          </div>}
          </div>
          <HistoryPage language={language} active={historyOpen} items={history.items} loading={history.loading} error={history.error}
            repository={history.repository} onBack={closeHistory} sessionActive={isActive}
            serviceReplayUnavailable={Boolean(import.meta.env.VITE_VOICE_API_BASE_URL?.trim())}
            onReplay={item => voiceRef.current?.replay(item.answer)} />
        </main>

        {/* A floating two-row grid keeps the button labels aligned. There is
            deliberately no fake mute control: voiceSession exposes no mute API. */}
        <nav className="action-dock" aria-label={t.controls}>
          <button ref={historyButtonRef} type="button" className="dock-side dock-history" onClick={openHistory} aria-label={t.history} aria-current={historyOpen ? 'page' : undefined}>
            <EchoIcon name="history" size={24} />
          </button>
          <span className="dock-caption dock-history-caption">{t.history}</span>

          <button
            type="button"
            className={`session-button ${isActive ? 'is-on' : ''} ${starting ? 'is-starting' : ''} phase-${phase}`}
            onClick={toggleSession}
            aria-label={sessionOn ? t.stopLabel : t.startLabel}
            aria-pressed={sessionOn}
            disabled={starting}
          >
            <span className="session-pulse" aria-hidden="true" />
            {starting ? <EchoIcon name="loader" size={32} className="spin-icon" />
              : sessionOn ? <EchoIcon name="stop" size={34} />
              : <EchoIcon name="eye" size={34} />}
          </button>
          <span className="dock-caption session-caption">{starting ? t.starting : sessionOn ? t.stop : t.start}</span>

          <button type="button" className="dock-side dock-signout" aria-label={u.signOut} onClick={() => setSignOutOpen(true)}><EchoIcon name="logout" size={24} /></button>
          <span className="dock-caption dock-signout-caption">{u.signOut}</span>
        </nav>
        {toast && <div className="app-toast"><p role="status">{toast}</p><button className="icon-control" aria-label={u.dismiss} onClick={() => setToast('')}><EchoIcon name="close" size={18} /></button></div>}
      </div>
      {signOutOpen && <Modal title={u.signOutTitle} closeLabel={u.close} onClose={() => setSignOutOpen(false)}>
        <p>{u.signOutBody}</p><p className="demo-note">{u.demoAccount}</p>
        <div className="confirmation-actions"><button className="text-button" onClick={() => setSignOutOpen(false)}>{u.cancel}</button>
          <button className="text-button danger-button" onClick={() => {
            // Future real-login callback belongs here only after separate authorization.
            // Demo confirmation intentionally performs no session, auth or storage action.
            setSignOutOpen(false); setToast(u.signedOut)
          }}>{u.signOut}</button></div>
      </Modal>}
    </div>
  )
}
