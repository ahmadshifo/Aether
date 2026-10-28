/**
 * Continuous, foreground-only voice session. Clearly labeled demo answers when AI is unavailable.
 * API contracts:
 *   POST {VITE_AI_API_BASE_URL}/api/v1/ask (JSON, existing team contract)
 *   POST {VITE_VOICE_API_BASE_URL}/api/v1/voice/transcribe (multipart audio+language)
 *   POST {VITE_VOICE_API_BASE_URL}/api/v1/voice/synthesize (JSON -> MP3)
 * Optional, NOT in the team contract yet: VITE_VISION_ASK_URL (multipart frame+question).
 */
export type Language = 'en' | 'ar'
export type Phase = 'idle' | 'listening' | 'hearing' | 'processing' | 'speaking' | 'paused'
export type HistoryItem = {
  id: string
  question: string
  answer: string
  time: string
  language: Language
  demo?: boolean
}

// Browser speech-recognition typings are absent from some TypeScript DOM builds.
type SpeechAlternative = { transcript: string; confidence: number }
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative }
type SpeechEvent = { resultIndex: number; results: { length: number; [index: number]: SpeechResult } }
type SpeechErrorEvent = { error: string }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionConstructor = new () => Recognition

type Callbacks = {
  onSession(active: boolean): void
  onPhase(phase: Phase): void
  onTranscript(text: string): void
  onAnswer(item: HistoryItem): void
  onError(text: string): void
  getFrame(): Promise<Blob | null>
}

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
const aiBase = (env.VITE_AI_API_BASE_URL ?? '').replace(/\/$/, '')
const voiceBase = (env.VITE_VOICE_API_BASE_URL ?? '').replace(/\/$/, '')
const visionAskUrl = env.VITE_VISION_ASK_URL ?? ''
const isVisionQuestion = (text: string) =>
  /\b(see|look|looking|read|written|color|colour|object|front of me|picture|image|camera|sign|door|where is|what is in front)\b|(?:أمام|تشوف|ترى|مكتوب|اقرأ|لون|صورة|كاميرا|باب|أرى|انظر|أشوف|شايف)/iu.test(text)
const wordsCount = (text: string) => (text.match(/\p{L}+/gu) ?? []).length
const validTranscript = (text: string, confidence?: number) =>
  wordsCount(text) >= 2 && !(confidence !== undefined && confidence > 0 && confidence < 0.35)
const locale = (language: Language) => language === 'ar' ? 'ar-SA' : 'en-US'
const translate = (language: Language, english: string, arabic: string) => language === 'ar' ? arabic : english

export class VoiceSession {
  private cb: Callbacks
  private active = false
  private phase: Phase = 'idle'
  private language: Language = 'en'
  private generation = 0
  private recognition: Recognition | null = null
  private recognizing = false
  private shouldRecognize = false
  private retryCount = 0
  private networkFailures = 0
  private arabicRecognitionLocale: 'ar-LB' | 'ar-SA' = 'ar-LB'
  private speechToken = 0
  private finishSpeech: (() => void) | null = null
  private retryTimer: number | null = null
  private finishTimer: number | null = null
  private resumeTimer: number | null = null
  private hiddenAt: number | null = null
  private finalParts = new Map<number, string>()
  private confidence: number | undefined
  private lastAsked = ''
  private lastAskedAt = 0
  private request: AbortController | null = null
  private voiceStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyzer: AnalyserNode | null = null
  private analyzerSource: MediaStreamAudioSourceNode | null = null
  private analysisTimer: number | null = null
  private recording: MediaRecorder | null = null
  private soundStartedAt = 0
  private aboveThresholdSince = 0
  private lastSoundAt = 0
  private noiseFloor = 0.008
  private fallbackEnabled = false
  private forceFallback = false
  private ttsAudio: HTMLAudioElement | null = null
  private ttsTimeout: number | null = null
  private wakeLock: WakeLockSentinel | null = null

  constructor(callbacks: Callbacks) { this.cb = callbacks }
  get isActive() { return this.active }

  private setPhase(phase: Phase) {
    this.phase = phase
    this.cb.onPhase(phase)
  }

  async start(language: Language) {
    if (this.active) return
    this.active = true
    this.generation += 1
    this.sessionId = crypto.randomUUID()
    this.language = language
    this.forceFallback = false
    this.networkFailures = 0
    this.retryCount = 0
    this.arabicRecognitionLocale = 'ar-LB'
    this.cb.onSession(true)
    this.cb.onError('')
    this.cb.onTranscript('')
    this.setPhase('listening')
    this.requestWakeLock()
    this.startInput()
  }

  stop() {
    this.active = false
    this.generation += 1
    this.stopInput()
    this.forceFallback = false
    this.speechToken += 1
    this.stopSpeech()
    this.request?.abort()
    this.request = null
    this.releaseWakeLock()
    this.cb.onTranscript('')
    this.cb.onSession(false)
    this.setPhase('idle')
  }

  changeLanguage(language: Language) {
    this.language = language
    if (!this.active) return
    this.generation += 1
    this.stopInput()
    this.speechToken += 1
    this.stopSpeech()
    this.request?.abort()
    this.request = null
    this.retryCount = 0
    this.arabicRecognitionLocale = 'ar-LB'
    this.cb.onTranscript('')
    this.cb.onError('')
    this.setPhase('listening')
    // Give the browser time to release the previous language's recognizer.
    const generation = this.generation
    if (document.visibilityState === 'visible') {
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null
        if (this.active && this.generation === generation) this.startInput()
      }, 350)
    }
  }

  onVisibilityChange() {
    if (!this.active) return
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now()
      this.stopInput()
      this.speechToken += 1
      this.stopSpeech()
      this.releaseWakeLock()
      this.request?.abort()
      this.setPhase('paused')
      return
    }
    const hiddenFor = Date.now() - (this.hiddenAt ?? Date.now())
    this.hiddenAt = null
    if (hiddenFor >= 60000) {
      this.cb.onError(translate(this.language,
        'Session paused after 60 seconds in the background. Tap Resume session to continue.',
        'توقفت الجلسة مؤقتًا بعد ٦٠ ثانية في الخلفية. اضغط استئناف الجلسة للمتابعة.'))
      this.setPhase('paused')
      return
    }
    this.resume()
  }

  pause() {
    if (!this.active) return
    this.stopInput()
    this.speechToken += 1
    this.stopSpeech()
    this.request?.abort()
    this.setPhase('paused')
  }

  resume() {
    if (!this.active || document.visibilityState !== 'visible') return
    this.cb.onError('')
    this.setPhase('listening')
    this.requestWakeLock()
    this.startInput()
  }

  private clearTimer(timer: number | null) { if (timer !== null) window.clearTimeout(timer) }

  private async requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (!this.active || document.visibilityState !== 'visible') { void lock.release(); return }
      this.wakeLock = lock
    } catch { /* optional capability */ }
  }
  private releaseWakeLock() {
    void this.wakeLock?.release().catch(() => {})
    this.wakeLock = null
  }

  private getRecognitionConstructor(): RecognitionConstructor | undefined {
    const browser = window as unknown as {
      SpeechRecognition?: RecognitionConstructor
      webkitSpeechRecognition?: RecognitionConstructor
    }
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
  }

  private startInput() {
    if (!this.active || this.phase !== 'listening' || document.visibilityState !== 'visible') return
    if (this.forceFallback || !this.getRecognitionConstructor()) {
      void this.startFallback(this.generation)
    } else {
      this.startRecognition(this.getRecognitionConstructor()!)
    }
  }

  private startRecognition(Constructor: RecognitionConstructor) {
    if (this.recognizing || this.recognition || !this.active) return
    const recognition = new Constructor()
    recognition.lang = this.language === 'ar' ? this.arabicRecognitionLocale : 'en-US'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    this.recognition = recognition
    this.shouldRecognize = true
    const generation = this.generation
    recognition.onresult = (event) => {
      if (generation !== this.generation || !this.active || !this.shouldRecognize) return
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        if (!result?.[0]) continue
        const text = result[0].transcript.trim()
        if (!text) continue
        if (result.isFinal) {
          this.finalParts.set(index, text)
          if (result[0].confidence > 0) this.confidence = result[0].confidence
        } else {
          interim += `${text} `
        }
      }
      const finalText = Array.from(this.finalParts.values()).join(' ').trim()
      const live = `${finalText} ${interim}`.trim()
      if (live) {
        this.cb.onError('')
        this.retryCount = 0
        this.networkFailures = 0
        this.setPhase('hearing')
        this.cb.onTranscript(live)
      }
      this.clearTimer(this.finishTimer)
      this.finishTimer = null
      // Recognition only triggers a request with at least one FINAL result.
      // The 1s grace period allows phrase fragments to be combined.
      if (finalText) this.finishTimer = window.setTimeout(() => this.finishRecognition(generation), 1000)
    }
    recognition.onerror = (event) => {
      if (generation !== this.generation || !this.shouldRecognize) return
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.cb.onError(translate(this.language,
          'Microphone or speech recognition permission was denied. Enable it in browser settings.',
          'تم رفض إذن الميكروفون أو التعرف على الكلام. فعّله من إعدادات المتصفح.'))
        this.stop()
      } else if (event.error === 'language-not-supported') {
        // Some browsers support one Arabic regional tag but not the other.
        // Never silently switch an Arabic question to English recognition.
        if (this.language === 'ar' && this.arabicRecognitionLocale === 'ar-LB') {
          this.arabicRecognitionLocale = 'ar-SA'
          this.cb.onError('تعذّر تشغيل العربية اللبنانية. نجرب العربية القياسية…')
        } else if (voiceBase) {
          this.forceFallback = true // Use the agreed /voice/transcribe endpoint.
          this.cb.onError(translate(this.language,
            'Browser recognition is unsupported. Trying the voice backend.',
            'تعذّر التعرف الصوتي في المتصفح. نجرب الخادم الصوتي.'))
        } else {
          this.cb.onError(translate(this.language,
            'This browser does not support the selected speech language. The voice backend is needed.',
            'هذا المتصفح لا يدعم التعرف على العربية. يلزم تشغيل خادم تحويل الكلام إلى نص.'))
          this.stop()
          return
        }
      } else if (event.error === 'audio-capture') {
        this.cb.onError(translate(this.language,
          'Microphone audio could not be captured. Check your microphone permission.',
          'تعذّر تسجيل صوت الميكروفون. تحقق من إذن الميكروفون.'))
        this.stop()
        return
      } else if (event.error === 'network') {
        this.networkFailures += 1
        if (this.networkFailures > 5) {
          this.cb.onError(translate(this.language,
            'Speech recognition network is unavailable. Check your connection and restart the session.',
            'خدمة التعرف على الكلام غير متصلة. تحقق من الشبكة وأعد تشغيل الجلسة.'))
          this.stop()
          return
        }
      }
      // no-speech and aborted are expected: onend handles restarts.
    }
    recognition.onend = () => {
      if (this.recognition !== recognition) return
      this.recognizing = false
      this.recognition = null
      if (this.active && this.shouldRecognize && this.phase !== 'processing' && this.phase !== 'speaking' && this.phase !== 'paused') {
        if (this.finalParts.size) {
          if (this.finishTimer === null) {
            this.finishTimer = window.setTimeout(() => this.finishRecognition(generation), 1000)
          }
        } else this.scheduleRestart(generation)
      }
    }
    try {
      recognition.start()
      this.recognizing = true
    } catch {
      this.recognition = null
      this.recognizing = false
      if (this.retryCount >= 5) {
        if (voiceBase) { this.forceFallback = true; void this.startFallback(generation) }
        else {
          this.cb.onError(translate(this.language, 'Speech recognition could not start.', 'تعذّر بدء التعرف على الكلام.'))
          this.stop()
        }
      } else this.scheduleRestart(generation)
    }
  }

  private scheduleRestart(generation: number) {
    if (!this.active || !this.shouldRecognize || generation !== this.generation || document.visibilityState !== 'visible') return
    this.clearTimer(this.retryTimer)
    const delay = Math.min(6000, 300 * 2 ** Math.min(this.retryCount++, 4))
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      if (generation !== this.generation || !this.active) return
      if (this.phase === 'hearing' && this.finalParts.size) {
        this.finishRecognition(generation)
      } else {
        this.setPhase('listening')
        this.cb.onTranscript('')
        this.startInput()
      }
    }, delay)
  }

  private finishRecognition(generation: number) {
    if (!this.active || generation !== this.generation || !this.finalParts.size) return
    const text = Array.from(this.finalParts.values()).join(' ').replace(/\s+/g, ' ').trim()
    const confidence = this.confidence
    this.finalParts.clear()
    this.confidence = undefined
    this.clearTimer(this.finishTimer)
    this.finishTimer = null
    if (!validTranscript(text, confidence)) {
      this.cb.onTranscript('')
      this.setPhase('listening')
      return
    }
    void this.handleQuestion(text, generation)
  }

  private stopInput() {
    this.shouldRecognize = false
    this.clearTimer(this.retryTimer); this.retryTimer = null
    this.clearTimer(this.finishTimer); this.finishTimer = null
    this.clearTimer(this.resumeTimer); this.resumeTimer = null
    const recognition = this.recognition
    this.recognition = null
    if (recognition) {
      recognition.onresult = null; recognition.onend = null; recognition.onerror = null
      try { recognition.abort() } catch { /* may have ended already */ }
    }
    this.recognizing = false
    this.finalParts.clear()
    this.confidence = undefined
    this.stopFallback()
  }

  private async startFallback(generation: number) {
    if (this.fallbackEnabled || !this.active) return
    if (!voiceBase) {
      this.cb.onError(translate(this.language,
        'This browser has no SpeechRecognition. Configure VITE_VOICE_API_BASE_URL to use microphone transcription.',
        'هذا المتصفح لا يدعم التعرف على الكلام. اضبط VITE_VOICE_API_BASE_URL للتفريغ الصوتي.'))
      this.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.cb.onError(translate(this.language,
        'Microphone recording is not supported on this browser.',
        'تسجيل الميكروفون غير مدعوم على هذا المتصفح.'))
      this.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}})
      if (!this.active || generation !== this.generation || this.phase !== 'listening') {
        stream.getTracks().forEach(track => track.stop()); return
      }
      const context = new AudioContext()
      await context.resume()
      if (!this.active || generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop()); void context.close(); return
      }
      this.voiceStream = stream
      this.audioContext = context
      this.analyzerSource = context.createMediaStreamSource(stream)
      this.analyzer = context.createAnalyser()
      this.analyzer.fftSize = 2048
      this.analyzerSource.connect(this.analyzer)
      this.fallbackEnabled = true
      this.startVAD(generation)
    } catch {
      this.cb.onError(translate(this.language, 'Microphone permission or audio recording failed.', 'فشل الوصول إلى الميكروفون أو التسجيل الصوتي.'))
      this.stop()
    }
  }

  // Energy-gated recorder is a FALLBACK, not a speech classifier. Short clips
  // are verified by the STT server before any AI call, so coughs/clicks cannot
  // directly trigger an AI request. Background speech/noise cannot be guaranteed.
  private startVAD(generation: number) {
    if (!this.analyzer || !this.voiceStream || this.analysisTimer !== null) return
    const buffer = new Float32Array(this.analyzer.fftSize)
    this.analysisTimer = window.setInterval(() => {
      if (!this.active || generation !== this.generation || document.visibilityState !== 'visible') return
      if (this.phase !== 'listening' && this.phase !== 'hearing') return
      this.analyzer?.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>)
      let energy = 0
      for (const value of buffer) energy += value * value
      const rms = Math.sqrt(energy / buffer.length)
      const threshold = Math.max(0.025, this.noiseFloor * 3)
      const now = performance.now()
      if (rms > threshold) {
        this.lastSoundAt = now
        if (!this.aboveThresholdSince) this.aboveThresholdSince = now
        if (this.phase === 'listening' && now - this.aboveThresholdSince >= 260) this.beginRecording(now, generation)
      } else {
        this.aboveThresholdSince = 0
        if (this.phase === 'listening') this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
        if (this.phase === 'hearing' && now - this.lastSoundAt > 1000) this.endRecording(generation)
      }
      // Upper bound to prevent unbounded blobs in a noisy environment.
      if (this.phase === 'hearing' && now - this.soundStartedAt > 12000) this.endRecording(generation)
    }, 65)
  }

  private beginRecording(now: number, generation: number) {
    if (!this.voiceStream || this.recording || generation !== this.generation) return
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type))
    try {
      const recorder = new MediaRecorder(this.voiceStream, mimeType ? {mimeType} : undefined)
      const chunks: BlobPart[] = []
      recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data) }
      recorder.onstop = () => {
        if (!this.active || generation !== this.generation || this.phase !== 'processing') return
        const audio = new Blob(chunks, {type: recorder.mimeType || 'audio/webm'})
        if (audio.size < 1500) { this.returnToListening(generation); return }
        void this.transcribeFallback(audio, generation)
      }
      this.recording = recorder
      this.soundStartedAt = now
      this.lastSoundAt = now
      this.setPhase('hearing')
      this.cb.onTranscript(translate(this.language, 'Hearing your voice…', 'أسمع صوتك…'))
      recorder.start()
    } catch { this.recording = null }
  }

  private endRecording(generation: number) {
    if (generation !== this.generation || this.phase !== 'hearing') return
    this.setPhase('processing')
    if (this.recording?.state === 'recording') this.recording.stop()
    this.recording = null
  }

  private async transcribeFallback(audio: Blob, generation: number) {
    const request = new AbortController()
    this.request = request
    try {
      const form = new FormData()
      form.append('audio', audio, audio.type.includes('mp4') ? 'question.m4a' : 'question.webm')
      form.append('language', this.language)
      const response = await fetch(`${voiceBase}/api/v1/voice/transcribe`, {method: 'POST', body: form, signal: request.signal})
      if (!response.ok) throw new Error(`Transcription service: HTTP ${response.status}`)
      const data = await response.json() as {text?: string; language?: string; confidence?: number}
      if (!this.active || generation !== this.generation) return
      const transcript = (data.text ?? '').trim()
      if (!validTranscript(transcript, data.confidence)) { this.returnToListening(generation); return }
      this.cb.onTranscript(transcript)
      await this.handleQuestion(transcript, generation)
    } catch (error) {
      if (request.signal.aborted) return
      await this.reportFailure(error, generation)
    } finally { if (this.request === request) this.request = null }
  }

  private async handleQuestion(question: string, generation: number) {
    if (!this.active || generation !== this.generation) return
    const normalized = question.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
    if (normalized === this.lastAsked && Date.now() - this.lastAskedAt < 4500) {
      this.returnToListening(generation)
      return
    }
    this.lastAsked = normalized
    this.lastAskedAt = Date.now()
    this.stopInput()
    this.cb.onTranscript(question)
    this.setPhase('processing')
    const request = new AbortController()
    this.request = request
    const lang = this.language
    try {
      // Capture exactly one bounded JPEG after the question ends.
      const frame = await this.cb.getFrame()
      if (!this.active || this.generation !== generation) return
      let answer: string
      let demo = false
      // Restore the original Room 205 demo ONLY after a real, valid question.
      // It is never presented as an observation of the live camera image.
      if (!frame && isVisionQuestion(question)) {
        answer = translate(lang,
          'The camera is off. Turn it on so I can describe what is in front of you.',
          'الكاميرا متوقفة. شغّلها حتى أتمكن من وصف ما أمامك.')
      } else if ((frame && !visionAskUrl && isVisionQuestion(question)) || (!aiBase && !visionAskUrl)) {
        demo = true
        answer = translate(lang,
          'The sign on the door reads Room 205.',
          'اللافتة على الباب مكتوب عليها غرفة ٢٠٥.')
      } else {
        answer = await this.askServer(question, frame, lang, request.signal)
      }
      if (!this.active || this.generation !== generation) return
      this.cb.onAnswer({id: crypto.randomUUID(), question, answer, language: lang, demo,
        time: new Date().toLocaleString(lang === 'ar' ? 'ar-LB' : 'en-US', {dateStyle: 'medium', timeStyle: 'short'})})
      await this.speakAndResume(answer, lang, generation)
    } catch (error) {
      if (!request.signal.aborted) await this.reportFailure(error, generation)
    } finally { if (this.request === request) this.request = null }
  }

  private async askServer(question: string, frame: Blob | null, language: Language, signal: AbortSignal): Promise<string> {
    const id = crypto.randomUUID()
    let response: Response
    if (frame && visionAskUrl) {
      // Explicit integration hook: no frame-upload endpoint is in api-v1.yaml yet.
      const form = new FormData()
      form.append('image', frame, `${id}.jpg`)
      form.append('question', question)
      form.append('question_id', id)
      form.append('session_id', this.sessionId)
      form.append('language', language)
      response = await fetch(visionAskUrl, {method: 'POST', body: form, signal})
    } else {
      if (!aiBase) throw new Error(translate(language,
        'AI service is not configured yet.', 'خدمة الذكاء الاصطناعي غير مهيّأة بعد.'))
      response = await fetch(`${aiBase}/api/v1/ask`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal,
        body: JSON.stringify({session_id: this.sessionId, question_id: id, question, language}),
      })
    }
    if (!response.ok) throw new Error(`AI service: HTTP ${response.status}`)
    const data = await response.json() as {answer?: string}
    if (!data.answer?.trim()) throw new Error('AI returned an empty answer.')
    return data.answer.trim()
  }

  private sessionId = crypto.randomUUID()

  private async reportFailure(error: unknown, generation: number) {
    if (!this.active || generation !== this.generation) return
    const detail = error instanceof Error ? error.message : 'Unknown error'
    this.cb.onError(detail)
    const message = translate(this.language,
      'Sorry, I could not answer that. You can ask another question.',
      'عذرًا، لم أستطع الإجابة. يمكنك طرح سؤال آخر.')
    await this.speakAndResume(message, this.language, generation)
  }

  private async speakAndResume(text: string, language: Language, generation: number) {
    if (!this.active || generation !== this.generation) return
    this.stopInput() // Echo protection: recognition/VAD must be off during TTS.
    this.setPhase('speaking')
    const token = ++this.speechToken
    await this.speak(text, language, generation)
    if (!this.active || generation !== this.generation || token !== this.speechToken || document.visibilityState !== 'visible') return
    this.resumeTimer = window.setTimeout(() => this.returnToListening(generation), 400)
  }

  private async speak(text: string, language: Language, generation: number): Promise<void> {
    this.stopSpeech()
    if (voiceBase) {
      try {
        const response = await fetch(`${voiceBase}/api/v1/voice/synthesize`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({text, language}),
        })
        if (!response.ok) throw new Error('Voice synthesis unavailable')
        const blob = await response.blob()
        if (!this.active || this.generation !== generation) return
        const url = URL.createObjectURL(blob)
        try {
          const audio = new Audio(url)
          this.ttsAudio = audio
          let failed = false
          await new Promise<void>((resolve) => {
            const finish = () => {
              this.clearTimer(this.ttsTimeout); this.ttsTimeout = null
              if (this.finishSpeech === finish) this.finishSpeech = null
              resolve()
            }
            this.finishSpeech = finish
            audio.onended = finish
            audio.onerror = () => { failed = true; finish() }
            this.ttsTimeout = window.setTimeout(() => { failed = true; finish() }, 20000)
            void audio.play().catch(() => { failed = true; finish() })
          })
          if (!failed) return
        } finally { URL.revokeObjectURL(url); this.ttsAudio = null }
      } catch { /* Web Speech synthesis fallback below */ }
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return
    await new Promise<void>(resolve => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = locale(language)
      utterance.rate = 0.95
      const finish = () => {
        this.clearTimer(this.ttsTimeout); this.ttsTimeout = null
        if (this.finishSpeech === finish) this.finishSpeech = null
        resolve()
      }
      this.finishSpeech = finish
      utterance.onend = finish
      utterance.onerror = finish
      this.ttsTimeout = window.setTimeout(() => { window.speechSynthesis.cancel(); finish() }, 18000)
      try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance) } catch { finish() }
    })
  }

  replay(text: string) {
    // Replay does not start recognition and should not wake an idle session.
    if (this.active) {
      const generation = this.generation
      void this.speakAndResume(text, this.language, generation)
    } else {
      this.speechToken += 1
      void this.speak(text, this.language, this.generation)
    }
  }

  private stopSpeech() {
    this.clearTimer(this.ttsTimeout); this.ttsTimeout = null
    const finish = this.finishSpeech
    this.finishSpeech = null
    finish?.()
    this.ttsAudio?.pause()
    this.ttsAudio = null
    window.speechSynthesis?.cancel()
  }

  private returnToListening(generation: number) {
    if (!this.active || generation !== this.generation || document.visibilityState !== 'visible') return
    this.cb.onTranscript('')
    this.setPhase('listening')
    this.startInput()
  }

  private stopFallback() {
    if (this.analysisTimer !== null) window.clearInterval(this.analysisTimer)
    this.analysisTimer = null
    if (this.recording) {
      this.recording.onstop = null
      try { if (this.recording.state !== 'inactive') this.recording.stop() } catch { /* already stopped */ }
      this.recording = null
    }
    this.voiceStream?.getTracks().forEach(track => track.stop())
    this.voiceStream = null
    this.analyzerSource?.disconnect()
    this.analyzer?.disconnect()
    this.analyzerSource = null
    this.analyzer = null
    void this.audioContext?.close().catch(() => {})
    this.audioContext = null
    this.fallbackEnabled = false
    this.noiseFloor = 0.008
    this.aboveThresholdSince = 0
  }
}
