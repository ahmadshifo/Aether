import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import HistoryPage from './HistoryPage'
import EchoIcon from './EchoIcon'
import { VoiceSession, type Language, type Phase } from './voiceSession'
import { WhipPublisher } from './whipPublisher'
import { reportStreamStart, reportStreamStop } from './streamRegistry'
import Modal from './Modal'
import { uiCopy } from './uiCopy'
import { useHistory } from './useHistory'
import { SnapshotBridge } from './snapshotBridge'
import AuthBoundary from './AuthBoundary'
import type { AccountProps } from './AuthBoundary'
import { authCopy } from './authCopy'
import MonoShell from './components/ui/MonoShell'

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
  return <AuthBoundary>{props => <AssistantApp {...props} />}</AuthBoundary>
}

function AssistantApp({ auth, session, authorized, repository, language, setLanguage }: AccountProps) {
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
  const [, setAnswerCollapsed] = useState(true)
  const [error, setError] = useState('')
  const history = useHistory(repository)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [toast, setToast] = useState(auth.getSnapshot().notice === 'created' ? authCopy[language].created : '')
  const snapshotRef = useRef(new SnapshotBridge())
  const languageRef = useRef(language)
  const transcriptRef = useRef('')
  const historyOpenRef = useRef(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLElement>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const publisherRef = useRef<WhipPublisher | null>(null)
  // The live/<id> this account is publishing, so Stop can tell the web dashboard it ended.
  const streamSessionRef = useRef<string | null>(null)
  const cameraRequestRef = useRef(0)
  const sessionAttemptRef = useRef(0)
  const requestedSessionRef = useRef(false)
  const voiceRef = useRef<VoiceSession | null>(null)
  const questionEpoch = useRef(0)
  const capturedEpoch = useRef(-1)
  const phaseRef = useRef<Phase>('idle')
  const startingRef = useRef(false)
  const permitted = () => auth.authorized(session.owner)
  function updateStarting(value: boolean) { startingRef.current = value; setStarting(value) }
  const u = uiCopy[language]

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  function reportStopped() {
    if (streamSessionRef.current) reportStreamStop(streamSessionRef.current)
    streamSessionRef.current = null
  }

  function stopCamera() {
    reportStopped()
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
      if (request !== cameraRequestRef.current || !permitted()) {
        stream.getTracks().forEach(track => track.stop())
        return false
      }
      cameraRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try { await videoRef.current.play() } catch { /* inline video still has a live stream */ }
      }
      if (request !== cameraRequestRef.current || !permitted()) { stream.getTracks().forEach(track => track.stop()); return false }
      setCameraOn(true)
      // Publish the existing camera track: no second camera or mic acquisition.
      const mediaBase = import.meta.env.VITE_MEDIAMTX_URL?.trim().replace(/\/$/, '')
      if (mediaBase) {
        const streamSessionId = voiceRef.current?.sessionIdForStreaming ?? crypto.randomUUID()
        const publisher = new WhipPublisher()
        publisherRef.current = publisher
        setStreamStatus('connecting')
        void publisher.start(stream, `${mediaBase}/live/${streamSessionId}/whip`).then(() => {
          if (publisherRef.current !== publisher) return
          setStreamStatus('live')
          // The web dashboard's Connect finds this stream through the signed-in account.
          streamSessionRef.current = streamSessionId
          reportStreamStart(streamSessionId)
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
    let alive = true
    const allowed = () => alive && auth.authorized(session.owner)
    const controller = new VoiceSession({
      onSession: (isOn) => {
        if (!allowed()) return
        setSessionOn(isOn)
        if (!isOn) snapshotRef.current.cancel()
        // A denied/failed microphone must never leave the camera recording.
        if (!isOn && requestedSessionRef.current) {
          requestedSessionRef.current = false
          sessionAttemptRef.current += 1
          stopCamera()
          updateStarting(false)
        }
      },
      onPhase: (next) => {
        if (!allowed()) return
        phaseRef.current = next
        if (next === 'paused') snapshotRef.current.cancel()
        else if (next !== 'processing') snapshotRef.current.discard()
        setPhase(next)
      },
      onTranscript: (text) => { if (allowed()) { transcriptRef.current = text; setTranscript(text) } },
      onError: (text) => { if (allowed()) { if (text) snapshotRef.current.discard(); setError(text) } },
      getFrame: async () => {
        if (!allowed()) return null
        const epoch = questionEpoch.current
        capturedEpoch.current = epoch
        const frame = await snapshotRef.current.capture(() => captureFrame(videoRef.current), controller.sessionIdForStreaming, transcriptRef.current, languageRef.current)
        return allowed() && epoch === questionEpoch.current ? frame : null
      },
      onAnswer: (item) => {
        if (!allowed() || capturedEpoch.current !== questionEpoch.current) return
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
      // Auth owns foreground revalidation. Resume remains an explicit public control.
      if (document.visibilityState === 'hidden') controller.onVisibilityChange()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      alive = false
      snapshots.cancel()
      document.removeEventListener('visibilitychange', handleVisibility)
      controller.stop()
      reportStopped()
      publisherRef.current?.stop()
      publisherRef.current = null
      if (voiceRef.current === controller) voiceRef.current = null
      requestedSessionRef.current = false
      sessionAttemptRef.current += 1
      cameraRequestRef.current += 1
      cameraRef.current?.getTracks().forEach(track => track.stop())
      cameraRef.current = null
    }
  }, [repository, auth, session.owner])

  useEffect(() => auth.onLock(reason => {
    questionEpoch.current++
    snapshotRef.current.cancel()
    setSignOutOpen(false); setHistoryOpen(false); historyOpenRef.current = false
    setAnswer(''); setTranscript(''); transcriptRef.current = ''; setToast(''); setError('')
    if (reason === 'revoke' || startingRef.current || phaseRef.current === 'processing' || phaseRef.current === 'hearing') {
      stopSession(); setSessionOn(false); phaseRef.current = 'idle'; setPhase('idle')
    } else {
      voiceRef.current?.pause()
      cameraRef.current?.getTracks().forEach(track => { track.enabled = false })
      if (voiceRef.current?.isActive) { phaseRef.current = 'paused'; setPhase('paused') }
    }
  }), [auth])
  useEffect(() => {
    if (!authorized) return
    cameraRef.current?.getTracks().forEach(track => { track.enabled = true })
    if (languageRef.current !== language) {
      languageRef.current = language
      voiceRef.current?.changeLanguage(language)
      voiceRef.current?.pause()
      snapshotRef.current.cancel()
    }
  }, [authorized, language])

  async function startSession() {
    if (!permitted() || sessionOn || starting || requestedSessionRef.current || !voiceRef.current) return
    const attempt = ++sessionAttemptRef.current
    requestedSessionRef.current = true
    updateStarting(true)
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
      updateStarting(false)
      return
    }
    setCameraUnavailable(!cameraReady)
    updateStarting(false)
  }

  function stopSession() {
    snapshotRef.current.cancel()
    requestedSessionRef.current = false
    sessionAttemptRef.current += 1
    voiceRef.current?.stop()
    stopCamera()
    setCameraUnavailable(false)
    updateStarting(false)
  }

  function changeLanguage(next: Language) {
    if (!permitted() || next === language) return
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
    if (!permitted() || historyOpenRef.current) return
    historyOpenRef.current = true
    snapshotRef.current.cancel()
    voiceRef.current?.pause()
    setHistoryOpen(true)
  }
  function closeHistory() {
    if (!permitted()) return
    historyOpenRef.current = false
    setHistoryOpen(false)
    voiceRef.current?.resume()
    contentRef.current?.scrollTo({ top: 0 })
    historyButtonRef.current?.focus()
  }

  const isActive = sessionOn || starting
  return (
    <div className="app-shell" hidden={!authorized} inert={!authorized} dir={language === 'ar' ? 'rtl' : 'ltr'} lang={language}>
      <MonoShell language={language} changeLanguage={changeLanguage} authorized={authorized} session={session}
        isActive={isActive} starting={starting} cameraOn={cameraOn} cameraUnavailable={cameraUnavailable}
        phase={phase} streamStatus={streamStatus} transcript={transcript} answer={answer} answerLanguage={answerLanguage} answerIsDemo={answerIsDemo}
        readSessionId={() => voiceRef.current?.isActive ? voiceRef.current.sessionIdForStreaming : undefined} error={error} items={history.items} loading={history.loading}
        videoRef={videoRef} contentRef={contentRef} historyButtonRef={historyButtonRef}
        start={() => { void startSession() }} stop={stopSession} resume={() => { if (permitted()) voiceRef.current?.resume() }}
        replay={() => { if (answerLanguage !== language) setToast(u.replayLanguage); else if (permitted()) voiceRef.current?.replay(answer) }}
        signOut={() => setSignOutOpen(true)} openHistory={openHistory} closeHistory={closeHistory}
        clearHistory={() => { if (permitted()) history.repository.clear() }}
        historyView={onBack => authorized && <HistoryPage language={language} active={historyOpen} items={history.items} loading={history.loading} error={history.error}
          repository={history.repository} onBack={onBack} sessionActive={isActive}
          serviceReplayUnavailable={Boolean(import.meta.env.VITE_VOICE_API_BASE_URL?.trim())}
          onReplay={item => { if (permitted()) voiceRef.current?.replay(item.answer) }} />}
        toast={toast && <div className="app-toast"><p role="status">{toast}</p><button className="icon-control" aria-label={u.dismiss} onClick={() => setToast('')}><EchoIcon name="close" size={18} /></button></div>}
      />
      {authorized && signOutOpen && <Modal title={u.signOutTitle} closeLabel={u.close} onClose={() => setSignOutOpen(false)}>
        <p>{u.signOutBody}</p>
        <div className="confirmation-actions"><button className="text-button" onClick={() => setSignOutOpen(false)}>{u.cancel}</button>
          <button className="text-button danger-button" onClick={() => {
            void auth.logout()
          }}>{u.signOut}</button></div>
      </Modal>}
    </div>
  )
}
