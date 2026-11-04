// Run against a production preview and an unchanged backend using a disposable DB.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH || 'C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const base = process.env.AUTH_TEST_ORIGIN || 'http://127.0.0.1:4173'
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(base)
  await page.getByRole('button', { name: 'Log in', exact: true }).waitFor()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  const checks = await page.evaluate(async () => {
    const input = { name: 'Synthetic proxy', email: `proxy-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() }
    const call = (path, body) => fetch(`/api/v1/auth/${path}`, { method: body || path === 'logout' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const signup = await call('signup', input)
    const me = await call('me')
    const duplicate = await call('signup', input)
    const logout = await call('logout')
    const signedOut = await call('me')
    const cacheUrls = (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat()
    return { signup: signup.status, me: me.status, duplicate: duplicate.status, logout: logout.status, signedOut: signedOut.status,
      noStore: [signup, me, duplicate, logout, signedOut].every(response => response.headers.get('cache-control') === 'no-store'),
      authCached: cacheUrls.some(url => new URL(url).pathname.startsWith('/api/v1/auth')), cookieVisible: document.cookie.includes('echosight_session') }
  })
  assert.deepEqual(checks, { signup: 201, me: 200, duplicate: 409, logout: 204, signedOut: 401, noStore: true, authCached: false, cookieVisible: false })
  await context.setOffline(true)
  const offline = await page.evaluate(async () => { try { await fetch('/api/v1/auth/me', { cache: 'no-store' }); return 'unexpected-response' } catch { return 'network-failure' } })
  assert.equal(offline, 'network-failure')
  console.log('PASS: production preview proxy, duplicate signup, HttpOnly cookie, no-store headers, active PWA worker excludes auth, offline /me cannot reuse cached identity.')
  await context.close()
} finally { await browser.close() }
