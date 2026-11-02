import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const packagePath = process.env.PLAYWRIGHT_PATH || 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(packagePath).href)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const output = new URL('./screenshots/', import.meta.url)
await mkdir(output, { recursive: true })
const checks = []
const failures = []
let lastPage
const base = 'http://127.0.0.1:5173'
const mockVoice = `export class VoiceSession {
  constructor(cb) { this.cb=cb; this.isActive=false; this.sessionIdForStreaming='test-session'; window.__voice=this; window.__metrics.created++; }
  start(language) { window.__metrics.starts++; this.language=language; this.isActive=true; this.cb.onSession(true); this.cb.onPhase('listening'); }
  stop() { window.__metrics.stops++; this.isActive=false; this.cb.onSession(false); this.cb.onPhase('idle'); }
  pause() { window.__metrics.pauses++; if(this.isActive) this.cb.onPhase('paused'); }
  resume() { window.__metrics.resumes++; if(this.isActive) this.cb.onPhase('listening'); }
  replay(text) { window.__metrics.replays.push(text); }
  changeLanguage(language) { this.language=language; }
  onVisibilityChange() {}
}`
async function setup(width = 390, height = 844, options = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US', timezoneId: 'Asia/Beirut', serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base) { failures.push(`Unexpected network request: ${url.origin}`); return route.abort() }
    if (url.pathname === '/src/App.tsx') {
      const response = await route.fetch()
      const source = (await response.text()).replaceAll('import.meta.env.VITE_VOICE_API_BASE_URL', options.voiceService ? "'test-voice-service'" : "''")
        .replaceAll('import.meta.env.VITE_MEDIAMTX_URL', "'http://127.0.0.1:5173/mock-media'")
      return route.fulfill({ response, body: source })
    }
    if (url.pathname === '/src/voiceSession.ts') return route.fulfill({ contentType: 'application/javascript', body: mockVoice })
    if (url.pathname === '/src/whipPublisher.ts') return route.fulfill({ contentType: 'application/javascript', body: `export class WhipPublisher { async start(){window.__metrics.publish++; ${options.streamFailure ? "throw new Error('Test stream failure')" : ''}} stop(){} }` })
    return route.continue()
  })
  await context.addInitScript(options => {
    window.__metrics = { created: 0, starts: 0, stops: 0, pauses: 0, resumes: 0, cameras: 0, publish: 0, replays: [] }
    HTMLMediaElement.prototype.play = async function() {}
    navigator.mediaDevices.getUserMedia = async () => {
      window.__metrics.cameras++
      if (options.cameraDenied) throw new DOMException('Camera denied', 'NotAllowedError')
      if (window.__holdCamera) await new Promise(resolve => { window.__releaseCamera = resolve })
      return new MediaStream()
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError') } } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    if (options.storage === 'blocked') {
      Object.defineProperty(window, 'indexedDB', { value: { open() { throw Error('Test blocked storage') } } })
      Storage.prototype.setItem = () => { throw Error('Test quota') }
    }
    if (options.storage === 'delayed') {
      const open = indexedDB.open.bind(indexedDB)
      indexedDB.open = (...args) => {
        const request = open(...args)
        const gate = { get result() { return request.result }, get error() { return request.error } }
        request.onupgradeneeded = () => gate.onupgradeneeded?.()
        request.onerror = () => gate.onerror?.()
        request.onblocked = () => gate.onblocked?.()
        request.onsuccess = () => { window.__releaseHistory = () => gate.onsuccess?.() }
        return gate
      }
    }
  }, options)
  const page = await context.newPage()
  lastPage = page
  page.on('pageerror', error => failures.push(error.message))
  await page.goto(base)
  await page.getByRole('button', { name: 'Start camera and microphone', exact: true }).waitFor()
  if (options.storage !== 'delayed') await page.evaluate(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/useHistory.ts').name)).getHistoryRepository().settled())
  return { context, page }
}
async function shot(page, name) {
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/(.:)/, '$1'), fullPage: true, animations: 'disabled' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  assert.equal(overflow, false, `Horizontal overflow: ${name}`)
  checks.push(name)
}
async function seed(page) {
  await page.evaluate(async () => {
    const { getHistoryRepository } = await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/useHistory.ts').name)
    const { historyFixtures } = await import('/src/historyFixtures.ts')
    const repo = getHistoryRepository()
    historyFixtures().reverse().forEach(item => repo.upsert(item))
    await repo.settled()
  })
}
async function callback(page, phase, language) {
  await page.evaluate(({ phase, language }) => {
    const voice = window.__voice
    voice.cb.onError('')
    voice.cb.onPhase(phase)
    if (phase === 'hearing') voice.cb.onTranscript(language === 'ar' ? 'ماذا يوجد أمامي؟' : 'What is in front of me?')
    if (phase === 'speaking') voice.cb.onAnswer({ id: 'state-answer', question: 'Sample question', answer: language === 'ar' ? 'إجابة تجريبية طويلة. '.repeat(40) : 'A clearly labeled sample answer for layout inspection. '.repeat(35), time: 'Test', language, demo: true })
  }, { phase, language })
}
try {
  if (!process.env.EDGES_ONLY) for (const [width, height] of [[360, 640], [390, 844], [768, 1024], [1280, 800]]) {
    for (const language of ['en', 'ar']) {
      const { context, page } = await setup(width, height)
      const prefix = `${width}x${height}-${language}`
      const ar = language === 'ar'
      if (ar) await page.getByRole('button', { name: 'AR', exact: true }).click()
      const history = page.getByRole('button', { name: ar ? 'السجل' : 'History', exact: true })
      await shot(page, `${prefix}-idle`)
      const center = await page.locator('.session-button').boundingBox()
      const shell = await page.locator('.action-dock').boundingBox()
      assert.ok(Math.abs(center.x + center.width / 2 - shell.x - shell.width / 2) < 2)
      await history.click()
      await shot(page, `${prefix}-empty`)
      await page.getByRole('button', { name: ar ? 'خيارات السجل' : 'History options' }).click()
      await page.getByRole('button', { name: ar ? 'خيارات السجل' : 'History options' }).click()
      await seed(page)
      await shot(page, `${prefix}-history`)
      await page.getByRole('searchbox').fill('not-in-any-record')
      await shot(page, `${prefix}-no-results`)
      await page.getByRole('button', { name: ar ? 'مسح البحث' : 'Clear search', exact: true }).first().click()
      await page.getByRole('button', { name: new RegExp(ar ? '^عرض المزيد:' : '^Read more:') }).first().click()
      await shot(page, `${prefix}-detail`)
      await page.getByRole('button', { name: ar ? 'فتح تكبير الصورة' : 'Open photo zoom' }).click()
      await page.getByRole('button', { name: ar ? 'تكبير' : 'Zoom in', exact: true }).click()
      await shot(page, `${prefix}-zoom`)
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
      await page.getByRole('button', { name: ar ? 'تسجيل الخروج' : 'Sign out', exact: true }).click()
      await shot(page, `${prefix}-signout`)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: ar ? 'خيارات السجل' : 'History options' }).click()
      await page.getByRole('button', { name: ar ? 'مسح الكل' : 'Clear all', exact: true }).click()
      await shot(page, `${prefix}-clear`)
      await page.getByRole('button', { name: ar ? 'إلغاء' : 'Cancel', exact: true }).click()
      await page.evaluate(() => { window.__holdCamera = true })
      await page.locator('.session-button').click() // Idle History: return Home + exactly one immediate start.
      await shot(page, `${prefix}-starting`)
      await page.evaluate(() => { window.__releaseCamera(); window.__holdCamera = false })
      await page.locator('.session-button:not(:disabled)').waitFor()
      for (const phase of ['listening', 'hearing', 'processing', 'speaking', 'paused']) {
        await callback(page, phase, language)
        await shot(page, `${prefix}-${phase}`)
      }
      await page.getByRole('button', { name: ar ? 'عرض الإجابة' : 'Expand answer' }).click()
      await shot(page, `${prefix}-long-answer`)
      await page.evaluate(() => window.__voice.cb.onError('MediaMTX streaming failed: simulated connection failure'))
      await shot(page, `${prefix}-error`)
      assert.equal(await page.locator('.stage-chip').innerText(), ar ? 'معاينة فقط' : 'Preview only')
      await context.close()
    }
  }
  const { context, page } = await setup()
  const originalVideo = await page.locator('video').elementHandle()
  const initial = await page.evaluate(() => ({ ...window.__metrics }))
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__metrics.pauses), initial.pauses + 1)
  await page.locator('.session-button').click()
  await page.locator('.session-button:not(:disabled)').waitFor()
  assert.equal(await page.evaluate(() => window.__metrics.starts), 1)
  await page.evaluate(() => window.__voice.cb.onError(''))
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await seed(page)
  const beforeSignout = await page.evaluate(() => ({ metrics: structuredClone(window.__metrics), storage: JSON.stringify(localStorage) }))
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  assert.match(await page.locator('.app-toast').innerText(), /Signed out \(demo\)/)
  const afterSignout = await page.evaluate(() => ({ metrics: structuredClone(window.__metrics), storage: JSON.stringify(localStorage) }))
  assert.deepEqual(afterSignout, beforeSignout)
  await page.getByRole('button', { name: 'Dismiss notification' }).click()
  assert.equal(await page.locator('video').evaluate((element, old) => element === old, originalVideo), true)
  const replays = await page.evaluate(() => window.__metrics.replays.length)
  await page.getByRole('button', { name: 'Replay', exact: true }).first().click({ force: true })
  assert.equal(await page.evaluate(() => window.__metrics.replays.length), replays)
  assert.match(await page.locator('.history-toast').innerText(), /Stop the session/)
  await page.getByRole('button', { name: 'Stop session', exact: true }).click()
  await page.getByRole('button', { name: 'Replay', exact: true }).first().click()
  assert.equal(await page.evaluate(() => window.__metrics.replays.length), replays + 1)
  const count = await page.locator('.history-card').count()
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  assert.equal(await page.locator('.history-card').count(), count - 1)
  await page.getByRole('button', { name: 'Undo', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.history-card').count(), count)
  await shot(page, 'interaction-undo')
  await page.getByRole('button', { name: /^Read more:/ }).first().click()
  assert.equal(await page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement)), true)
  for (let i = 0; i < 14; i++) await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement)), true)
  await page.getByRole('dialog').getByRole('button', { name: 'Copy', exact: true }).click()
  await page.getByRole('textbox', { name: 'Select and copy' }).waitFor()
  await shot(page, 'interaction-copy-fallback')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Share text', exact: true }).click()
  await page.getByRole('textbox', { name: 'Select and copy' }).waitFor()
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__shared = { text: data.text, files: data.files?.length ?? 0, url: data.url } } })
  })
  await page.getByRole('button', { name: 'Share text', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__shared.files), 0)
  assert.equal(await page.evaluate(() => window.__shared.url), undefined)
  await page.getByRole('button', { name: 'Share with photo', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__shared.files), 1)
  await page.keyboard.press('Escape')
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /Read more/)
  await page.getByRole('button', { name: 'AR', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__metrics.created), initial.created)
  await page.getByRole('button', { name: 'إعادة الاستماع', exact: true }).first().click({ force: true })
  assert.match(await page.locator('.history-toast').innerText(), /بلغة مختلفة/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await shot(page, 'large-text-rtl-history')
  await page.getByRole('button', { name: 'العودة إلى الرئيسية', exact: true }).click()
  await shot(page, 'large-text-rtl-home')
  assert.equal(await page.locator('.welcome-ring').first().evaluate(element => getComputedStyle(element).animationName), 'none')
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  await page.reload()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.locator('.history-card img').first().waitFor()
  assert.equal(await page.locator('.history-card').count(), count)
  await page.getByRole('button', { name: 'History options' }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear all', exact: true }).click()
  await page.evaluate(async () => (await import(performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/useHistory.ts').name)).getHistoryRepository().settled())
  await page.reload()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('No questions yet', { exact: true }).waitFor()
  checks.push('Interactions: stable camera/controller; Start once; mock signout inert; replay guards; delete/undo; clipboard/share fallback; focus; reload photos; clear persists; reduced motion')
  await context.close()
  for (const language of ['en', 'ar']) {
    const ar = language === 'ar'
    const delayed = await setup(360, 640, { storage: 'delayed' })
    if (ar) await delayed.page.getByRole('button', { name: 'AR', exact: true }).click()
    await delayed.page.getByRole('button', { name: ar ? 'السجل' : 'History', exact: true }).click()
    await shot(delayed.page, `edge-${language}-loading`)
    assert.equal(await delayed.page.locator('.skeleton').count(), 2)
    await delayed.page.waitForFunction(() => !!window.__releaseHistory)
    await delayed.page.evaluate(() => window.__releaseHistory())
    await delayed.page.getByText(ar ? 'لا توجد أسئلة بعد' : 'No questions yet', { exact: true }).waitFor()
    await delayed.context.close()
    const blocked = await setup(360, 640, { storage: 'blocked', cameraDenied: true })
    const p = blocked.page
    if (ar) await p.getByRole('button', { name: 'AR', exact: true }).click()
    await p.locator('.session-button').click()
    await p.locator('.voice-only-chip').waitFor()
    await shot(p, `edge-${language}-voice-only`)
    await p.evaluate(() => { window.__voice.stop(); window.__voice.cb.onError('Microphone permission denied (test).') })
    await p.getByRole('button', { name: ar ? 'إعادة محاولة البدء' : 'Retry Start', exact: true }).waitFor()
    await shot(p, `edge-${language}-permission-error`)
    const starts = await p.evaluate(() => window.__metrics.starts)
    await p.getByRole('button', { name: ar ? 'إعادة محاولة البدء' : 'Retry Start', exact: true }).click()
    assert.equal(await p.evaluate(() => window.__metrics.starts), starts + 1)
    await p.getByRole('button', { name: ar ? 'السجل' : 'History', exact: true }).click()
    await seed(p)
    await p.locator('.storage-alert').waitFor()
    await shot(p, `edge-${language}-storage-failure`)
    const before = await p.locator('.history-card').count()
    const card = p.locator('.history-card').first()
    await card.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 160, clientY: 200 })
    await card.dispatchEvent('pointerup', { pointerType: 'touch', clientX: ar ? 280 : 40, clientY: 210 })
    assert.equal(await p.locator('.history-card').count(), before - 1)
    await p.getByRole('button', { name: ar ? 'تراجع' : 'Undo', exact: true }).click()
    assert.equal(await p.locator('.history-card').count(), before)
    await card.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 160, clientY: 200 })
    await card.dispatchEvent('pointerup', { pointerType: 'touch', clientX: ar ? 280 : 40, clientY: 300 })
    assert.equal(await p.locator('.history-card').count(), before)
    await p.getByRole('searchbox').fill('Please describe this object')
    await p.getByRole('button', { name: new RegExp(ar ? '^عرض المزيد:' : '^Read more:') }).click()
    await shot(p, `edge-${language}-no-photo-long-detail`)
    assert.match(await p.locator('.detail-content').innerText(), /ceramic cup/)
    await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text } } }) })
    await p.getByRole('dialog').getByRole('button', { name: ar ? 'نسخ' : 'Copy', exact: true }).click()
    assert.match(await p.evaluate(() => window.__copied), /ceramic cup/)
    await p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('cancel', 'AbortError') } }) })
    await p.getByRole('button', { name: ar ? 'مشاركة النص' : 'Share text', exact: true }).click()
    assert.equal(await p.getByRole('dialog').count(), 1)
    await p.getByRole('dialog').getByRole('button', { name: ar ? 'حذف' : 'Delete', exact: true }).click()
    assert.equal(await p.getByRole('dialog').count(), 0)
    await p.getByRole('button', { name: ar ? 'تراجع' : 'Undo', exact: true }).click()
    await p.getByRole('button', { name: ar ? 'مسح البحث' : 'Clear search', exact: true }).first().click()
    await p.getByRole('button', { name: ar ? 'إغلاق الإشعار' : 'Dismiss notification', exact: true }).click()
    await p.setViewportSize({ width: 390, height: 500 })
    await p.getByRole('searchbox').focus()
    await shot(p, `edge-${language}-keyboard-sized-viewport`)
    const dock = await p.locator('.action-dock').boundingBox()
    assert.ok(dock.y + dock.height <= 500)
    await p.setViewportSize({ width: 360, height: 640 })
    await p.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await shot(p, `edge-${language}-large-history`)
    await p.getByRole('button', { name: ar ? 'العودة إلى الرئيسية' : 'Back to Home', exact: true }).click()
    await p.locator('.session-button').click()
    await shot(p, `edge-${language}-large-home`)
    const shortTargets = await p.locator('button:visible').evaluateAll(buttons => buttons.filter(button => { const r = button.getBoundingClientRect(); return r.width < 48 || r.height < 48 }).map(button => button.outerHTML))
    assert.deepEqual(shortTargets, [])
    await blocked.context.close()
  }
  const preview = await setup()
  const saved = await preview.page.evaluate(() => JSON.stringify(localStorage))
  await preview.page.goto(`${base}/?preview=history`)
  await preview.page.locator('.history-card').first().waitFor()
  assert.equal(await preview.page.locator('.history-card').count(), 8)
  assert.equal(await preview.page.evaluate(() => JSON.stringify(localStorage)), saved)
  assert.equal(await preview.page.evaluate(() => window.__metrics.cameras), 0)
  await shot(preview.page, 'development-history-preview')
  await preview.context.close()
  const service = await setup(390, 844, { voiceService: true, streamFailure: true })
  await seed(service.page)
  await service.page.getByRole('button', { name: 'History', exact: true }).click()
  await service.page.getByRole('button', { name: 'Replay', exact: true }).first().click({ force: true })
  assert.match(await service.page.locator('.history-toast').innerText(), /current voice service/)
  assert.equal(await service.page.evaluate(() => window.__metrics.replays.length), 0)
  await service.page.locator('.session-button').click()
  await service.page.getByText('Preview only', { exact: true }).waitFor()
  await service.page.getByRole('button', { name: 'History', exact: true }).click()
  await service.page.getByRole('button', { name: 'Back to Home', exact: true }).click()
  await service.page.evaluate(() => window.__voice.cb.onError(''))
  assert.equal(await service.page.locator('.stage-chip').innerText(), 'Preview only')
  await shot(service.page, 'stream-failure-survives-voice-error-reset')
  await service.context.close()
  checks.push('Edge interactions: loading, denied storage, text fallback, voice only, permission Retry, RTL swipe vs vertical scroll, long no-photo detail, Copy success, Share cancellation, selected deletion, keyboard-sized viewport, 200% text, 48px controls, isolated preview')
} catch (error) {
  failures.push(error.stack)
  if (lastPage && !lastPage.isClosed()) {
    await shot(lastPage, 'failure-diagnostic').catch(() => {})
    failures.push(await lastPage.locator('body').innerText())
  }
}
await browser.close()
await writeFile(new URL(process.env.EDGES_ONLY ? './browser-edge-results.json' : './browser-results.json', import.meta.url), JSON.stringify({ checks, failures }, null, 2))
console.log(JSON.stringify({ checks: checks.length, failures }, null, 2))
if (failures.length) process.exitCode = 1
