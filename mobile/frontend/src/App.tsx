
import { useEffect, useRef, useState } from 'react'

type Phase = 'off' | 'listening' | 'thinking' | 'speaking' | 'ready'
type Language = 'en' | 'ar'

const words = {
  en: {
    subtitle: 'Your AI visual assistant',
    camera: 'Live camera',
    on: 'Camera active',
    off: 'Camera off',
    start: 'Start Assistant',
    stop: 'Stop Assistant',
    ready: 'Ready to help',
    listening: 'Listening to your question...',
    thinking: 'Thinking...',
    speaking: 'Speaking answer...',
    again: 'Ready for another question',
    hint: 'Tap once to activate the camera and microphone',
    latest: 'Latest answer',
    demo: 'Demo answer — real AI not connected yet',
    answer: 'The sign on the door reads Room 205.',
    privacy: 'Camera and microphone stop when you end the session.',
  },
  ar: {
    subtitle: 'مساعدك البصري الذكي',
    camera: 'الكاميرا المباشرة',
    on: 'الكاميرا تعمل',
    off: 'الكاميرا متوقفة',
    start: 'ابدأ المساعد',
    stop: 'إيقاف المساعد',
    ready: 'جاهز للمساعدة',
    listening: 'أستمع إلى سؤالك...',
    thinking: 'أفكر...',
    speaking: 'أنطق الإجابة...',
    again: 'جاهز لسؤال آخر',
    hint: 'اضغط مرة واحدة لتشغيل الكاميرا والميكروفون',
    latest: 'آخر إجابة',
    demo: 'إجابة تجريبية — الذكاء الاصطناعي غير متصل بعد',
    answer: 'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.',
    privacy: 'تتوقف الكاميرا والميكروفون عند إنهاء الجلسة.',
  },
}

export default function App() {
  const [language, setLanguage] = useState<Language>('en')
  const [active, setActive] = useState(false)
  const [phase, setPhase] = useState<Phase>('off')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timersRef = useRef<number[]>([])
  const runRef = useRef(0)

  const t = words[language]

  function clearTimers() {
    timersRef.current.forEach(window.clearTimeout)
    timersRef.current = []
  }

  function stopAssistant() {
    runRef.current += 1
    clearTimers()

    window.speechSynthesis?.cancel()

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setActive(false)
    setPhase('off')
  }

  function demoAnswer(run: number, lang: Language) {
    const firstTimer = window.setTimeout(() => {
      if (runRef.current !== run) return

      setPhase('thinking')

      const secondTimer = window.setTimeout(() => {
        if (runRef.current !== run) return

        const message = words[lang].answer

        setAnswer(message)
        setPhase('speaking')

        if (!('speechSynthesis' in window)) {
          setPhase('ready')
          return
        }

        const utterance = new SpeechSynthesisUtterance(message)
        utterance.lang = lang === 'ar' ? 'ar-SA' : 'en-US'
        utterance.rate = 0.95

        utterance.onend = () => {
          if (runRef.current === run) setPhase('ready')
        }

        utterance.onerror = () => {
          if (runRef.current === run) setPhase('ready')
        }

        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)

        // Safety fallback if the browser doesn't fire onend.
        const fallback = window.setTimeout(() => {
          if (runRef.current === run) setPhase('ready')
        }, 10000)

        timersRef.current.push(fallback)
      }, 1200)

      timersRef.current.push(secondTimer)
    }, 6500)

    timersRef.current.push(firstTimer)
  }

  async function startAssistant() {
    setError('')
    const run = ++runRef.current

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera and microphone are unavailable.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      if (runRef.current !== run) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }

      setActive(true)
      setPhase('listening')
      setAnswer('')

      // Temporary demo: this is NOT real speech detection.
      demoAnswer(run, language)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to start assistant.'
      )
      setPhase('off')
    }
  }

  useEffect(() => {
    return () => {
      runRef.current += 1
      timersRef.current.forEach(window.clearTimeout)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      window.speechSynthesis?.cancel()
    }
  }, [])

  const status = !active
    ? t.ready
    : phase === 'listening'
      ? t.listening
      : phase === 'thinking'
        ? t.thinking
        : phase === 'speaking'
          ? t.speaking
          : t.again

  return (
    <main
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-dvh bg-[#071724] text-white"
    >
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-6">
        <header className="mb-7 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-[#43DCD1]">◉</span> EchoSight
            </h1>
            <p className="mt-1 text-xs text-[#A3BFCA]">
              {t.subtitle}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLanguage('en')}
              aria-pressed={language === 'en'}
              className={`min-h-11 min-w-11 rounded-xl px-3 ${
                language === 'en'
                  ? 'bg-[#087F87] text-white'
                  : 'bg-[#163144] text-[#A3BFCA]'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLanguage('ar')}
              aria-pressed={language === 'ar'}
              className={`min-h-11 min-w-11 rounded-xl px-3 ${
                language === 'ar'
                  ? 'bg-[#087F87] text-white'
                  : 'bg-[#163144] text-[#A3BFCA]'
              }`}
            >
              ع
            </button>
          </div>
        </header>

        <section className="rounded-3xl border border-[#24465B] bg-[#10283A] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">{t.camera}</h2>
            <span className="text-xs text-[#69E0C6]">
              {active ? '● ' + t.on : t.off}
            </span>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#081B29]">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label={t.camera}
              className={`h-full w-full object-cover ${
                active ? 'block' : 'hidden'
              }`}
            />

            {!active && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#8DABB8]">
                <span className="text-5xl" aria-hidden="true">◎</span>
                <span className="text-sm">{t.off}</span>
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-1 flex-col items-center justify-center py-9 text-center">
          <p
            role="status"
            aria-live="polite"
            className="mb-7 min-h-7 text-lg font-medium text-[#C8E4E9]"
          >
            {status}
          </p>

          <button
            type="button"
            onClick={active ? stopAssistant : startAssistant}
            aria-label={active ? t.stop : t.start}
            className={`flex h-32 w-32 items-center justify-center rounded-full border-4 border-[#7BDAD7] shadow-[0_0_35px_rgba(31,191,185,0.25)] transition active:scale-95 ${
              active ? 'bg-[#B34255]' : 'bg-[#087F87]'
            }`}
          >
            <span aria-hidden="true" className="text-5xl">
              {active ? '■' : '🎙'}
            </span>
          </button>

          <h2 className="mt-6 text-2xl font-bold">
            {active ? t.stop : t.start}
          </h2>

          <p className="mt-3 max-w-xs text-sm leading-6 text-[#A3BFCA]">
            {active ? t.privacy : t.hint}
          </p>
        </section>

        {answer && (
          <section
            aria-label={t.latest}
            className="mb-5 rounded-2xl border border-[#24465B] bg-[#10283A] p-5"
          >
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#43DCD1]">
              {t.latest}
            </h2>
            <p className="text-lg leading-7">{answer}</p>
            <p className="mt-3 text-xs text-[#9CBAC6]">
              {t.demo}
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-red-950 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <footer className="pb-3 text-center text-xs text-[#789BAA]">
          EchoSight · Mobile Assistant Prototype
        </footer>
      </div>
    </main>
  )
}
