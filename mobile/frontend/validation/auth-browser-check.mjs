// Uses fresh ephemeral browser contexts only; no real media, profile, API keys or AI calls.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH || 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const base = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:5173'
const artifacts = await mkdtemp(join(tmpdir(), 'echosight-auth-browser-'))
const checks = [], failures = [], secrets = []
const synthetic = id => ({ user_id: `${id.repeat(8)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(12)}`, name: `Synthetic ${id}`, email: `${id}@example.test`, created_at: '2026-11-02T00:00:00Z' })
const a = synthetic('a'), b = synthetic('b')
const voice = `export class VoiceSession {
  constructor(cb) { this.cb=cb; this.isActive=false; this.sessionIdForStreaming=crypto.randomUUID(); window.__voice=this; window.__voices.push(this); window.__metrics.created++; }
  start(language) { this.language=language; this.sessionIdForStreaming=crypto.randomUUID(); this.isActive=true; window.__metrics.starts++; this.cb.onSession(true); this.cb.onPhase('listening'); }
  stop() { this.isActive=false; window.__metrics.stops++; this.cb.onSession(false); this.cb.onPhase('idle'); }
  pause() { window.__metrics.pauses++; if(this.isActive) this.cb.onPhase('paused'); }
  resume() { window.__metrics.resumes++; if(this.isActive) this.cb.onPhase('listening'); }
  replay() {} changeLanguage(language) {this.language=language;} onVisibilityChange() {this.pause();}
}`
async function setup(scenario = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'en-US' })
  const counts = {}
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    // Fonts are intentionally blocked in this isolated fallback-font matrix.
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort()
    if (url.origin !== base) { failures.push(`Unexpected network origin ${url.origin}`); return route.abort() }
    if (url.pathname.startsWith('/api/v1/auth/')) {
      counts[url.pathname] = (counts[url.pathname] || 0) + 1
      if (scenario.live) return route.continue()
      if (scenario.handle) { const handled = await scenario.handle(route, url.pathname); if (handled) return }
      if (url.pathname.endsWith('/me')) return route.fulfill({ status: scenario.outage ? 503 : scenario.user ? 200 : 401, json: scenario.outage ? {} : scenario.user ? { user: scenario.user } : { error: { code: 'not_authenticated' } } })
      if (url.pathname.endsWith('/logout')) {
        if (scenario.logoutFails) return route.fulfill({ status: 503, json: {} })
        scenario.user = null; return route.fulfill({ status: 204 })
      }
      if (scenario.loginError) return route.fulfill({ status: scenario.loginError === 'too_many_attempts' ? 429 : 401, json: { error: { code: scenario.loginError } } })
      scenario.user = scenario.nextUser || a
      return route.fulfill({ status: url.pathname.endsWith('/signup') ? 201 : 200, json: { user: scenario.user } })
    }
    if (url.pathname === '/src/voiceSession.ts') return route.fulfill({ contentType: 'application/javascript', body: voice })
    if (url.pathname === '/src/whipPublisher.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export class WhipPublisher { async start(){window.__metrics.publish++} stop(){window.__metrics.publisherStops++} }' })
    if (url.pathname === '/src/App.tsx') {
      const response = await route.fetch()
      return route.fulfill({ response, body: (await response.text()).replaceAll('import.meta.env.VITE_MEDIAMTX_URL', JSON.stringify(`${base}/mock-media`)).replaceAll('import.meta.env.VITE_VOICE_API_BASE_URL', "''") })
    }
    return route.continue()
  })
  await context.addInitScript(() => {
    window.__metrics = { created: 0, cameras: 0, starts: 0, stops: 0, tracksStopped: 0, publish: 0, publisherStops: 0, pauses: 0, resumes: 0 }
    window.__voices = []
    navigator.mediaDevices.getUserMedia = async () => {
      window.__metrics.cameras++
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2dd4bf'; ctx.fillRect(0, 0, 320, 240)
      const stream = canvas.captureStream(1)
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { window.__metrics.tracksStopped++; stop() } })
      return stream
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text } } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__shared = { text: data.text, photos: data.files?.length || 0 } } })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  })
  const page = await context.newPage()
  page.on('pageerror', error => failures.push(error.message))
  await page.goto(base)
  return { context, page, scenario, counts }
}
async function login(page, email = a.email, password = crypto.randomUUID()) {
  secrets.push(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  if (await page.locator('.auth-landing').isVisible()) await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
}
async function home(page) {
  await page.locator('.mono-shell').waitFor()
  if (await page.locator('.welcome-screen').isVisible()) await page.getByRole('button', { name: 'Get started', exact: true }).click()
  if (await page.locator('.assistant-idle').isVisible()) await page.getByRole('button', { name: 'Back to Home', exact: true }).click()
  if (await page.getByRole('navigation').isVisible()) await page.getByRole('navigation').getByRole('button', { name: 'Home', exact: true }).click()
  await page.locator('.home-screen').waitFor()
}
async function leaveAssistant(page) {
  if (await page.locator('.assistant-screen').isVisible()) {
    await page.getByRole('button', { name: 'Back to Home', exact: true }).click()
    if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: 'Stop and go Home', exact: true }).click()
  }
}
async function signout(page) {
  await leaveAssistant(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click()
}
async function ask(page, id) {
  await page.evaluate(async id => {
    const v = window.__voice; v.cb.onTranscript(`Question ${id}`); v.cb.onPhase('processing'); await v.cb.getFrame()
    v.cb.onAnswer({ id, question: `Question ${id}`, answer: `Synthetic answer ${id}`, language: 'en', time: 'Synthetic', demo: true }); v.cb.onPhase('listening')
  }, id)
}
async function screenshot(page, name) {
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true, mask: [page.locator('input[data-secret]')], animations: 'disabled' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow ${name}`)
}
try {
  // Delayed boot never constructs private storage or requests media.
  let release
  const gate = new Promise(resolve => { release = resolve })
  const boot = await setup({ handle: async (route, path) => { if (!path.endsWith('/me')) return false; await gate; await route.fulfill({ status: 401, json: {} }).catch(() => {}); return true } })
  await boot.page.getByText('Checking your session…').waitFor()
  assert.equal(await boot.page.locator('.history-screen').count(), 0)
  assert.equal(await boot.page.evaluate(() => window.__metrics.cameras), 0)
  assert.deepEqual(await boot.page.evaluate(async () => (await indexedDB.databases()).map(db => db.name)), [])
  release(); await boot.page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  await boot.context.close(); checks.push('Unknown identity: no private DOM, storage or media')

  const outage = await setup({ outage: true })
  await outage.page.getByText('The sign-in service is unavailable. Check the connection and try again.').waitFor()
  assert.equal(await outage.page.locator('form').count(), 0)
  outage.scenario.outage = false; await outage.page.getByRole('button', { name: 'Check session again' }).click()
  await outage.page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  outage.scenario.loginError = 'invalid_credentials'; await login(outage.page)
  await outage.page.getByText('Email or password is incorrect.').waitFor()
  outage.scenario.loginError = 'too_many_attempts'; await login(outage.page)
  await outage.page.getByText('Too many failed attempts. Try again in 15 minutes.').waitFor()
  await outage.context.close(); checks.push('Outage recovery, wrong-password and rate-limit UI')

  // Layout, password-manager attributes, keyboard validation, RTL and 200% text.
  const form = await setup()
  await form.page.getByRole('button', { name: 'Sign up', exact: true }).click()
  assert.equal(await form.page.getByLabel('Password', { exact: true }).getAttribute('autocomplete'), 'new-password')
  await form.page.getByRole('button', { name: 'Create account', exact: true }).click()
  await form.page.locator('#auth-error').waitFor()
  assert.equal(await form.page.locator('#auth-error').evaluate(el => el === document.activeElement), true)
  for (const language of ['en', 'ar']) {
    await form.page.getByRole('button', { name: language.toUpperCase(), exact: true }).click()
    for (const width of [360, 390, 768]) {
      await form.page.setViewportSize({ width, height: 640 }); await form.page.emulateMedia({ reducedMotion: 'reduce' })
      await screenshot(form.page, `signup-${language}-${width}`)
    }
    await form.page.setViewportSize({ width: 360, height: 640 })
    await form.page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await screenshot(form.page, `signup-${language}-200-percent`)
    assert.equal(await form.page.locator('button:visible').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 48)), true)
    await form.page.evaluate(() => { document.documentElement.style.fontSize = '' })
  }
  await form.context.close(); checks.push('EN/AR forms, RTL, focus, reduced motion, 200% text and 48px targets')

  const accounts = await setup({ user: a })
  const { page } = accounts
  await home(page)
  // Anonymous keys are synthetic and intentionally ownerless.
  const legacy = JSON.stringify([{ id: 'legacy-private', question: 'Unclaimed legacy', answer: 'Never assigned', language: 'en', time: '' }])
  await page.evaluate(legacy => { localStorage.setItem('echosight-local-history-v1', legacy) }, legacy)
  await page.getByRole('button', { name: 'Start camera and microphone', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await ask(page, 'A-one')
  const originalSession = await page.evaluate(() => window.__voice.sessionIdForStreaming)
  // Same-user auth revalidation must retain the active controller and session ID.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await page.getByRole('button', { name: 'Hold to stop', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__voice.sessionIdForStreaming), originalSession)
  await leaveAssistant(page)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Question A-one', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  const beforeCancel = await page.evaluate(() => ({ ...window.__metrics }))
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.__metrics), beforeCancel)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await home(page)
  assert.equal(await page.evaluate(() => window.__voice.sessionIdForStreaming), originalSession)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Question A-one', { exact: true }).waitFor()
  accounts.scenario.logoutFails = true
  await signout(page)
  await page.getByRole('button', { name: 'Retry sign out' }).waitFor()
  assert.equal(await page.locator('.history-screen').count(), 0)
  assert.ok(await page.evaluate(() => window.__metrics.tracksStopped > 0 && window.__metrics.publisherStops > 0 && !window.__voices.at(-1).isActive))
  await page.evaluate(() => window.__voices.at(-1).cb.onAnswer({ id: 'late-A', question: 'Late private A', answer: 'Never show', language: 'en', time: '' }))
  accounts.scenario.logoutFails = false
  await page.getByRole('button', { name: 'Retry sign out' }).click()
  await page.getByText('Signed out. Your local History is kept for your next login.').waitFor()
  accounts.scenario.nextUser = b
  await login(page, b.email); await home(page)
  assert.equal(await page.evaluate(() => window.__metrics.cameras), 1)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('No questions yet', { exact: true }).waitFor()
  assert.equal(await page.getByText('Unclaimed legacy', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Assistant: Start camera and microphone', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  await ask(page, 'B-one'); await signout(page)
  accounts.scenario.nextUser = a
  await login(page); await home(page)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Question A-one', { exact: true }).waitFor()
  assert.equal(await page.getByText('Question B-one', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Late private A', { exact: true }).count(), 0)
  await page.getByRole('searchbox').fill('A-one')
  await page.getByRole('button', { name: /^Read more:/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Copy', exact: true }).click()
  assert.match(await page.evaluate(() => window.__copied), /A-one/)
  await page.getByRole('button', { name: 'Share with photo', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__shared.photos), 1)
  await screenshot(page, 'account-A-photo-detail'); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByText('Question A-one', { exact: true }).waitFor()
  await page.reload(); await home(page)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Question A-one', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'History options' }).click()
  await page.getByRole('button', { name: 'Clear all', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear all', exact: true }).click()
  await signout(page); accounts.scenario.nextUser = b
  await login(page, b.email); await home(page); await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByText('Question B-one', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('echosight-local-history-v1')), legacy)
  // Another tab replaces the shared cookie: hints lock, then /me supplies actual B/A identity.
  const tab = await accounts.context.newPage(); await tab.goto(base); await home(tab)
  await signout(tab)
  await page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  assert.equal(await page.locator('.history-screen').count(), 0)
  await accounts.context.close(); checks.push('Account A/B images, search, copy/share, Undo, reload, scoped Clear, legacy, logout failure, late answer, pageshow and cross-tab logout')

  const capturing = await setup({ user: a })
  await home(capturing.page)
  await capturing.page.locator('.home-feature button').click()
  await capturing.page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
  const captureStops = await capturing.page.evaluate(() => window.__metrics.stops)
  const other = await capturing.context.newPage(); await other.goto(base); await home(other)
  await signout(other)
  await capturing.page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  assert.ok(await capturing.page.evaluate(before => window.__metrics.stops > before && window.__metrics.tracksStopped > 0 && window.__metrics.publisherStops > 0, captureStops))
  assert.equal(await capturing.page.locator('.history-screen').count(), 0)
  await capturing.context.close(); checks.push('Logout in another tab during capture stops the existing owner immediately without a hold')

  if (process.env.AUTH_LIVE === '1') {
    const live = await setup({ live: true })
    const p = live.page, password = crypto.randomUUID(); secrets.push(password)
    const emailA = `mobile-a-${crypto.randomUUID()}@example.test`, emailB = `mobile-b-${crypto.randomUUID()}@example.test`
    async function signup(email, name) {
      await p.getByRole('button', { name: 'Sign up', exact: true }).waitFor()
      await p.getByRole('button', { name: 'Sign up', exact: true }).click()
      await p.getByLabel('Name', { exact: true }).fill(name)
      await p.getByLabel('Email', { exact: true }).fill(email)
      await p.getByLabel('Password', { exact: true }).fill(password)
      await p.getByLabel('Confirm password', { exact: true }).fill(password)
      await p.getByRole('button', { name: 'Create account', exact: true }).click(); await home(p)
      assert.equal(await p.evaluate(() => window.__metrics.cameras), 0)
      const cookie = (await live.context.cookies()).find(cookie => cookie.name === 'echosight_session')
      assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Lax'); assert.equal(cookie.secure, base.startsWith('https:'))
      assert.equal(await p.evaluate(() => document.cookie.includes('echosight_session')), false)
      const me = await p.evaluate(async () => { const response = await fetch('/api/v1/auth/me', { cache: 'no-store', credentials: 'same-origin' }); return { status: response.status, user: (await response.json()).user, cache: response.headers.get('cache-control') } })
      assert.equal(me.status, 200); assert.equal(me.user.email, email); assert.equal(me.cache, 'no-store')
      return me.user.user_id
    }
    const idA = await signup(emailA, 'Synthetic local A')
    await signout(p); await p.getByRole('button', { name: 'Log in', exact: true }).waitFor()
    assert.equal((await live.context.cookies()).some(cookie => cookie.name === 'echosight_session'), false)
    assert.equal(await p.evaluate(async () => (await fetch('/api/v1/auth/me', { cache: 'no-store' })).status), 401)
    const idB = await signup(emailB, 'Synthetic local B'); assert.notEqual(idA, idB)
    await signout(p); await login(p, emailA, password); await home(p)
    assert.equal(await p.evaluate(async () => (await (await fetch('/api/v1/auth/me', { cache: 'no-store' })).json()).user.user_id), idA)
    await signout(p); await live.context.close()
    checks.push('LIVE unchanged SQLite auth through same-origin mobile proxy: two signups, HttpOnly/Lax cookies, /me, logout deletion, 401 and login again')
  }
} catch (error) {
  let message = error.stack || String(error)
  for (const secret of secrets) message = message.replaceAll(secret, '[redacted synthetic credential]')
  failures.push(message)
} finally { await browser.close() }
await writeFile(join(artifacts, 'results.json'), JSON.stringify({ checks, failures }, null, 2))
console.log(JSON.stringify({ checks, failures, artifacts }, null, 2))
if (failures.length) process.exitCode = 1
