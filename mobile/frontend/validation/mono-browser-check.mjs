import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const packagePath = process.env.PLAYWRIGHT_PATH || 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(packagePath).href)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const artifacts = await mkdtemp(join(tmpdir(), 'aether-mono-browser-'))
const output = pathToFileURL(`${artifacts}/screenshots/`)
await mkdir(output, { recursive: true })
const checks = []
const failures = []
const contrast = []
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
    // Fonts are intentionally blocked in this isolated fallback-font matrix.
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.abort()
    if (url.origin !== base) { failures.push(`Unexpected network request: ${url.origin}`); return route.abort() }
    if (url.pathname === '/api/v1/auth/me' && options.signedOut) return route.fulfill({ status: 401, json: {} })
    if (url.pathname === '/api/v1/auth/me') return route.fulfill({ json: { user: { user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Synthetic A', email: 'a@example.test', created_at: '2026-11-02T00:00:00Z' } } })
    // Test-only instrumentation is injected into isolated browser responses, never app source.
    if (url.pathname === '/src/useHistory.ts') {
      const response = await route.fetch()
      return route.fulfill({ response, body: (await response.text()).replace('return new LocalHistoryRepository(', 'return window.__testRepository = new LocalHistoryRepository(') })
    }
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
  if (options.signedOut) { await page.locator('.auth-landing').waitFor(); return { context, page } }
  await page.locator('.welcome-screen').waitFor()
  if (!options.welcome) { await page.getByRole('button', { name: 'Get started', exact: true }).click(); await page.locator('.home-screen').waitFor() }
  if (options.storage !== 'delayed') await page.evaluate(async () => window.__testRepository.settled())
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
    const { historyFixtures } = await import('/src/historyFixtures.ts')
    const repo = window.__testRepository
    historyFixtures().reverse().forEach(item => repo.upsert(item))
    await repo.settled()
  })
}
async function callback(page, phase, language) {
  await page.evaluate(async ({ phase, language }) => {
    const voice = window.__voice
    voice.cb.onError('')
    voice.cb.onPhase(phase)
    if (phase === 'hearing') voice.cb.onTranscript(language === 'ar' ? 'ماذا يوجد أمامي؟' : 'What is in front of me?')
    if (phase === 'speaking') { await voice.cb.getFrame(); voice.cb.onAnswer({ id: 'state-answer', question: 'Sample question', answer: language === 'ar' ? 'إجابة تجريبية طويلة. '.repeat(40) : 'A clearly labeled sample answer for layout inspection. '.repeat(35), time: 'Test', language, demo: true }) }
  }, { phase, language })
}

async function stopAndHome(page, ar = false) {
  await page.getByRole('button', { name: ar ? 'العودة إلى الرئيسية' : 'Back to Home', exact: true }).click()
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: ar ? 'إيقاف والعودة للرئيسية' : 'Stop and go Home', exact: true }).click()
}
async function clickNav(page, name) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click() }
async function auditLayout(page, name) {
  const result = await page.evaluate(() => {
    const main = document.querySelector('.app-content')
    const bad = [...document.querySelectorAll('button')].filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => ({ name: el.getAttribute('aria-label') || el.textContent, r: el.getBoundingClientRect() })).filter(({ r }) => r.width < 44 || r.height < 44).map(({ name, r }) => ({ name, width: r.width, height: r.height }))
    return { overflow: main ? main.scrollWidth > main.clientWidth + 1 : false, bad }
  })
  assert.equal(result.overflow, false, `Main horizontal overflow: ${name}`)
  assert.deepEqual(result.bad, [], `Small controls: ${name}`)
}
async function auditContrast(page, selectors) {
  const values = await page.evaluate(selectors => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number)
    const lum = color => { const c=rgb(color).slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2] }
    return selectors.map(selector => {
      const el=document.querySelector(selector), css=getComputedStyle(el);let parent=el,bg
      while(parent){bg=getComputedStyle(parent).backgroundColor;if(rgb(bg)[3]!==0)break;parent=parent.parentElement}
      const a=lum(css.color),b=lum(bg);return {selector,foreground:css.color,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
    })
  }, selectors)
  values.forEach(value=>assert.ok(value.ratio>=4.5,`Contrast ${value.selector}: ${value.ratio}`)); contrast.push(...values)
}
try {
  for (const [width, height] of [[320,568],[360,640],[390,844],[430,932],[844,390],[768,1024],[1280,800]]) {
    for (const language of ['en', 'ar']) {
      const ar = language === 'ar', prefix = `${width}x${height}-${language}`
      const auth = await setup(width, height, { signedOut: true })
      if (ar) await auth.page.getByRole('button', { name: 'AR', exact: true }).click()
      await shot(auth.page, `${prefix}-auth-landing`)
      await auth.page.getByRole('button', { name: ar ? 'تسجيل الدخول' : 'Log in', exact: true }).click()
      await shot(auth.page, `${prefix}-login`)
      await auth.context.close()
      const { page, context } = await setup(width, height, { welcome: true })
      if (ar) await page.getByRole('button', { name: 'AR', exact: true }).click()
      await shot(page, `${prefix}-welcome`); await auditLayout(page, `${prefix}-welcome`)
      if(width===390){ await page.locator('.welcome-screen .safety-note').scrollIntoViewIfNeeded(); await shot(page,`${prefix}-welcome-safety`) }
      assert.equal(await page.evaluate(() => window.__metrics.cameras + window.__metrics.starts), 0)
      await page.getByRole('button', { name: ar ? 'لنبدأ' : 'Get started', exact: true }).click()
      await shot(page, `${prefix}-home`); await auditLayout(page, `${prefix}-home`)
      const before = await page.evaluate(() => ({ ...window.__metrics }))
      await page.locator('.playing-card').nth(3).focus(); await page.keyboard.press('Enter')
      assert.deepEqual(await page.evaluate(() => window.__metrics), before, 'Selection cannot start capture or submit')
      await page.locator('.selected-question').scrollIntoViewIfNeeded()
      await shot(page, `${prefix}-selection`)
      await clickNav(page, ar ? 'الإعدادات' : 'Settings')
      await shot(page, `${prefix}-settings`); await auditLayout(page, `${prefix}-settings`)
      if(width===390){ await page.locator('.account-card').scrollIntoViewIfNeeded(); await shot(page,`${prefix}-settings-account`) }
      assert.equal(await page.getByRole('combobox').isDisabled(), true)
      await page.getByRole('button', { name: ar ? 'الاتصال' : 'Connection', exact: true }).click()
      await shot(page, `${prefix}-connection`); await auditLayout(page, `${prefix}-connection`)
      assert.equal(await page.locator('[aria-current="page"]').count(), 1)
      assert.equal(await page.getByRole('button', { name: ar ? 'نسخ معرّف الجلسة' : 'Copy session ID', exact: true }).isDisabled(), true)
      await clickNav(page, ar ? 'المساعدة' : 'Help')
      await shot(page, `${prefix}-help`); await auditLayout(page, `${prefix}-help`)
      if(width===390){ await page.locator('.help-screen .safety-note').scrollIntoViewIfNeeded(); await shot(page,`${prefix}-help-safety`) }
      await clickNav(page, ar ? 'السجل' : 'History'); await seed(page)
      await shot(page, `${prefix}-history`); await auditLayout(page, `${prefix}-history`)
      await page.locator('.history-expand').first().click(); await shot(page, `${prefix}-history-expanded`)
      await clickNav(page, ar ? 'الرئيسية' : 'Home')
      await page.locator('.selected-question button').click()
      await page.locator('.hold-button').waitFor()
      assert.equal(await page.evaluate(() => window.__metrics.starts), 1)
      assert.equal(await page.locator('nav:visible').count(), 0)
      await shot(page, `${prefix}-assistant`); await auditLayout(page, `${prefix}-assistant`)
      await page.getByRole('button', { name: ar ? 'خيارات الإيقاف' : 'Stop options', exact: true }).click()
      await shot(page, `${prefix}-stop-confirm`)
      await page.keyboard.press('Escape')
      await stopAndHome(page, ar)
      await page.locator('.status-link').click()
      assert.equal(await page.locator('.scramble-id bdi').innerText(), 'test-session')
      await page.getByRole('button', { name: ar ? 'نسخ معرّف الجلسة' : 'Copy session ID', exact: true }).click()
      await page.getByText(ar ? 'الحافظة غير متاحة. حدّد المعرّف أعلاه واستخدم أمر النسخ في جهازك.' : 'Clipboard unavailable. Select the ID above and use your device’s Copy command.').waitFor()
      await shot(page, `${prefix}-ticket-copy-fallback`)
      if (width === 320 || width === 390) {
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
        for (const [name, label] of [['home',ar ? 'الرئيسية':'Home'],['settings',ar ? 'الإعدادات':'Settings'],['help',ar ? 'المساعدة':'Help'],['history',ar ? 'السجل':'History']]) {
          await clickNav(page,label); await shot(page, `${prefix}-large-${name}`); await auditLayout(page, `${prefix}-large-${name}`)
        }
      }
      await context.close()
    }
  }
  const { page, context } = await setup()
  await auditContrast(page,['.home-feature .tactile-button','.home-greeting p','.selected-question .fine-print','.tab-bar button[aria-current="page"]'])
  const originalVideo = await page.locator('video').elementHandle()
  await page.locator('.home-feature button').click()
  const metrics = await page.evaluate(() => ({ ...window.__metrics }))
  const hold = page.locator('.hold-button')
  await auditContrast(page,['.hold-label','.stage-chip','.phase-row'])
  // Ordinary pointer click opens a non-timed dialog and never stops capture.
  await hold.click(); assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops)
  assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape')
  const box = await hold.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(450); await page.mouse.up()
  assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops)
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(1100)
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, 'Threshold arms; pointer-down never stops')
  await page.mouse.move(1,1); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, 'Leaving cancels armed hold')
  for (const event of ['pointercancel','lostpointercapture']) {
    await page.mouse.move(x,y); await page.mouse.down(); await hold.dispatchEvent(event,{pointerId:1}); await page.waitForTimeout(1050); await page.mouse.up()
    assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, event)
  }
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(1100); await page.keyboard.press('Escape'); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, 'Escape cancels')
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(1100); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, 'Blur cancels')
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(1100); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.mouse.up()
  await page.locator('.hold-button').waitFor()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops, 'Visibility revalidation cancels the hold')
  await page.mouse.move(x,y); await page.mouse.down(); await page.waitForTimeout(1100); await page.mouse.up()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops + 1)
  assert.equal(await page.getByRole('dialog').count(), 0, 'No synthetic second click/dialog')
  await shot(page,'hold-complete-idle')
  await page.locator('.assistant-idle').click()
  await hold.focus(); await page.keyboard.press('Enter')
  assert.equal(await page.getByRole('dialog').count(), 1)
  await page.getByRole('dialog').getByRole('button',{name:'Stop session',exact:true}).click()
  assert.equal(await page.evaluate(() => window.__metrics.stops), metrics.stops + 2)
  await page.locator('.assistant-idle').click(); await hold.evaluate(el => el.click())
  assert.equal(await page.getByRole('dialog').count(),1); await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Back to Home',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await page.locator('video').evaluate((el,old)=>el === old,originalVideo),true)
  assert.equal(await page.evaluate(() => window.__metrics.created),metrics.created)
  await stopAndHome(page)
  // Native Chromium touch events, separately from pointer and synthesized activation.
  await page.locator('.home-feature button').click()
  const touch = await context.newCDPSession(page), touchBox = await hold.boundingBox()
  const point = { x: touchBox.x + touchBox.width/2, y: touchBox.y + touchBox.height/2, id: 0 }
  const touchStops = await page.evaluate(() => window.__metrics.stops)
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.equal(await page.evaluate(() => window.__metrics.stops),touchStops)
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape')
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
  await page.waitForTimeout(1100)
  assert.equal(await page.evaluate(() => window.__metrics.stops),touchStops)
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.equal(await page.evaluate(() => window.__metrics.stops),touchStops+1)
  await page.locator('.assistant-idle').click()
  const unmountStops=await page.evaluate(()=>window.__metrics.stops)
  await page.mouse.move(point.x,point.y); await page.mouse.down()
  await page.evaluate(()=>window.__voice.stop()) // Existing automatic cleanup is never gated by the gesture.
  await page.locator('.assistant-idle').waitFor(); await page.waitForTimeout(1100); await page.mouse.up()
  assert.equal(await page.evaluate(()=>window.__metrics.stops),unmountStops+1,'Unmount cancels pending hold without a second stop')
  await stopAndHome(page)
  await page.emulateMedia({ reducedMotion:'reduce' })
  await page.locator('.home-feature button').click(); await callback(page,'processing','en')
  assert.equal(await page.locator('.trace-outline').evaluate(el=>getComputedStyle(el).animationName),'none')
  await callback(page,'speaking','en')
  assert.ok((await page.locator('.receipt-answer').innerText()).length > 1000)
  assert.equal(await page.locator('.receipt-answer').evaluate(el=>getComputedStyle(el).webkitLineClamp),'none')
  await shot(page,'reduced-motion-long-answer')
  await page.locator('.cassette').scrollIntoViewIfNeeded(); await shot(page,'receipt-cassette-fallback')
  await stopAndHome(page); await seed(page); await clickNav(page,'History')
  await page.getByRole('button',{name:'Delete',exact:true}).first().click()
  assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),1)
  await clickNav(page,'Settings')
  const count = await page.evaluate(()=>window.__testRepository.list().length)
  await page.getByRole('button',{name:'Hold to clear history',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__testRepository.list().length),count)
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('button',{name:'Clear options',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Clear all',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__testRepository.list().length),0)
  await clickNav(page,'History'); assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),0)
  await shot(page,'settings-clear-no-stale-undo')
  await page.emulateMedia({ forcedColors:'active' }); await shot(page,'forced-colors')
  checks.push('Hold: tap/keyboard/synthetic confirmation; threshold/release; leave/cancel/lost capture/Escape; clear; persistent media owner; reduced motion; full answers')
  await context.close()
} catch(error) {
  failures.push(error.stack)
  if(lastPage && !lastPage.isClosed()) { await shot(lastPage,'failure-diagnostic').catch(()=>{}); failures.push(await lastPage.locator('body').innerText()) }
} finally { await browser.close() }
await writeFile(join(artifacts,'mono-results.json'),JSON.stringify({checks,failures,contrast},null,2))
console.log(JSON.stringify({checks:checks.length,failures,artifacts},null,2))
if(failures.length) process.exitCode=1
