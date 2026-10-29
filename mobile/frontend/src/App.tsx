import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import HistoryPage from './HistoryPage'
import EchoIcon from './EchoIcon'
import { VoiceSession, type Language, type Phase, type HistoryItem } from './voiceSession'
import { WhipPublisher } from './whipPublisher'

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

const STORE_KEY = 'echosight-local-history-v1'
function readHistory(): HistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is HistoryItem =>
          item != null && typeof item.question === 'string' && typeof item.answer === 'string'
          && typeof item.id === 'string' && (item.language === 'en' || item.language === 'ar'))
      : []
  } catch { return [] }
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

export default function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessionOn, setSessionOn] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerIsDemo, setAnswerIsDemo] = useState(false)
  const [answerCollapsed, setAnswerCollapsed] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>(readHistory)

  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const publisherRef = useRef<WhipPublisher | null>(null)
  const cameraRequestRef = useRef(0)
  const sessionAttemptRef = useRef(0)
  const requestedSessionRef = useRef(false)
  const voiceRef = useRef<VoiceSession | null>(null)
  const t = words[language]

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
        void publisher.start(stream, `${mediaBase}/live/${streamSessionId}/whip`).catch((reason: unknown) => {
          if (publisherRef.current !== publisher) return
          publisherRef.current = null
          setError(`MediaMTX streaming failed: ${reason instanceof Error ? reason.message : String(reason)}`)
        })
      } else {
        setError('MediaMTX URL missing: set VITE_MEDIAMTX_URL in .env.local')
      }
      return true
    } catch {
      if (request === cameraRequestRef.current) setCameraOn(false)
      return false
    }
  }

  useEffect(() => {
    const controller = new VoiceSession({
      onSession: (isOn) => {
        setSessionOn(isOn)
        // A denied/failed microphone must never leave the camera recording.
        if (!isOn && requestedSessionRef.current) {
          requestedSessionRef.current = false
          sessionAttemptRef.current += 1
          stopCamera()
          setStarting(false)
        }
      },
      onPhase: setPhase,
      onTranscript: setTranscript,
      onError: setError,
      getFrame: () => captureFrame(videoRef.current),
      onAnswer: (item) => {
        setAnswer(item.answer)
        setAnswerIsDemo(Boolean(item.demo))
        setAnswerCollapsed(true)
        setHistory(previous => {
          const updated = [item, ...previous].slice(0, 50)
          try { localStorage.setItem(STORE_KEY, JSON.stringify(updated)) } catch { /* private mode */ }
          return updated
        })
      },
    })
    voiceRef.current = controller
    const handleVisibility = () => controller.onVisibilityChange()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
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
  }, [])

  async function startSession() {
    if (sessionOn || starting || !voiceRef.current) return
    const attempt = ++sessionAttemptRef.current
    requestedSessionRef.current = true
    setStarting(true)
    setCameraUnavailable(false)
    setError('')

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
    else void startSession()
  }

  function changeLanguage(next: Language) {
    if (next === language) return
    setLanguage(next)
    voiceRef.current?.changeLanguage(next)
  }

  function openHistory() {
    voiceRef.current?.pause()
    setHistoryOpen(true)
  }
  function closeHistory() {
    setHistoryOpen(false)
    voiceRef.current?.resume()
  }

  const isActive = sessionOn || starting
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

        <main className="app-content" id="main-content">
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
                <p>{t.voiceOnlyHint}</p>
              </div>
            )}

            {/* One top overlay: the camera chip never changes its location. */}
            <div className="stage-top-overlay">
              <span className={`stage-chip ${cameraOn ? 'is-live' : ''}`} aria-label={`${t.camera}: ${cameraOn ? t.on : t.off}`}>
                <span className="live-dot" aria-hidden="true" />
                {cameraOn ? t.on : t.off}
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
                  onClick={(event: MouseEvent<HTMLElement>) => {
                    if (!(event.target as HTMLElement).closest('button')) {
                      setAnswerCollapsed(v => !v)
                    }
                  }}
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
                      <button type="button" className="replay-control" aria-label={t.replay} onClick={() => voiceRef.current?.replay(answer)}>
                        <EchoIcon name="volume" size={21} />
                      </button>
                    )}
                  </div>
                  <p className="answer-text" aria-live="polite">
                    {showingTranscript ? transcript : answer}
                  </p>
                </section>
              </div>
            )}
          </section>
          {error && <p role="alert" className="error-alert">{error}</p>}
        </main>

        {/* A floating two-row grid keeps the button labels aligned. There is
            deliberately no fake mute control: voiceSession exposes no mute API. */}
        <nav className="action-dock" aria-label={t.controls}>
          <button type="button" className="dock-side dock-history" onClick={openHistory} aria-label={t.history}>
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

          <span className="dock-spacer" aria-hidden="true" />
          <span className="dock-caption dock-spacer-label" aria-hidden="true">&nbsp;</span>
        </nav>
      </div>
      {historyOpen && <HistoryPage language={language} items={history} onBack={closeHistory} />}
    </div>
  )
}
