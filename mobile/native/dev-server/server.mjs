/** Isolated fixture. Validation/hash/session semantics adapted from
 * web/ai-backend/app/auth.py at bb54dbd. Never imports or opens the team backend.
 * node:sqlite is experimental in Node 22; this is development infrastructure only. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const appRoot = path.resolve(import.meta.dirname, '..');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$16384$8$1$${salt}$${scryptSync(password, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
}
function passwordMatches(password, stored) {
  const parts = stored.split('$');
  const candidate = passwordHash(password, parts[4]).split('$')[5];
  return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(parts[5], 'hex'));
}
function fail(status, code) { throw Object.assign(new Error(code), { status, code }); }
const profile = row => ({ user_id: row.user_id, email: row.email, name: row.name, created_at: row.created_at });

export function createFixture({ database, secure = true, now = Date.now, sessionMs = 7 * 86400000, allowedOrigins = [] }) {
  const resolved = path.resolve(database);
  if (!resolved.startsWith(appRoot + path.sep)) throw Error('Fixture database must be inside mobile/native');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(user_id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS streams(session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id), started_at TEXT NOT NULL, stopped_at TEXT);
    CREATE TABLE IF NOT EXISTS fixture_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO fixture_meta VALUES (?,?)').run('environment', randomUUID());
  const environment = db.prepare('SELECT value FROM fixture_meta WHERE key=?').get('environment').value;
  const cookieName = `aether_native_${environment.replaceAll('-', '')}`;
  const dummy = passwordHash(randomBytes(32).toString('hex'));
  const failures = new Map();
  const iso = () => new Date(now()).toISOString();
  const auth = req => {
    const raw = (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!raw || raw.length > 256) return null;
    const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(raw), now());
    return row ? { ...profile(row), hash: tokenHash(raw) } : null;
  };
  function session(res, id, req) {
    const old = auth(req);
    if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(old.hash);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), id, now() + sessionMs);
    res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/api/v1; Max-Age=${Math.floor(sessionMs / 1000)}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'invalid_request');
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 8192) fail(413, 'invalid_request'); }
    try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
    catch { fail(400, 'invalid_request'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.statusCode = status; res.end(status === 204 ? undefined : JSON.stringify(value)); };
    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) fail(403, 'origin_denied');
      if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return send(204); }
      const route = (req.url ?? '').split('?')[0];
      if (route === '/health' && req.method === 'GET') return send(200, { service: 'aether-native-fixture', storage: 'sqlite', answers: 'demo', environment });
      if (route === '/api/v1/auth/me' && req.method === 'GET') {
        const user = auth(req); if (!user) fail(401, 'not_authenticated'); return send(200, { user: profile(user) });
      }
      if (route === '/api/v1/auth/logout' && req.method === 'POST') {
        const user = auth(req);
        if (user) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.hash); db.prepare('UPDATE streams SET stopped_at=? WHERE user_id=? AND stopped_at IS NULL').run(iso(), user.user_id); }
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/api/v1; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
        return send(204);
      }
      if (['/api/v1/auth/signup', '/api/v1/auth/login'].includes(route) && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.email !== 'string' || typeof input.password !== 'string') fail(422, 'invalid_request');
        const email = input.email.trim().toLowerCase();
        if ([...email].length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'invalid_email');
        if ([...input.password].length > 128) fail(400, 'weak_password');
        if (route.endsWith('signup')) {
          if (typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 80) fail(400, 'invalid_name');
          if ([...input.password].length < 8) fail(400, 'weak_password');
          const user = { user_id: randomUUID(), email, name: input.name.trim(), created_at: iso() };
          if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409, 'email_taken');
          db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(user.user_id, email, user.name, passwordHash(input.password), user.created_at);
          session(res, user.user_id, req); return send(201, { user });
        }
        for (const [key, values] of failures) if (!values.some(t => t > now() - 900000)) failures.delete(key);
        const recent = (failures.get(email) ?? []).filter(t => t > now() - 900000);
        if (recent.length >= 5 || failures.size >= 10000) fail(429, 'too_many_attempts');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const valid = passwordMatches(input.password, user?.password_hash ?? dummy);
        if (!user || !valid) { failures.set(email, [...recent, now()]); fail(401, 'invalid_credentials'); }
        failures.delete(email); session(res, user.user_id, req); return send(200, { user: profile(user) });
      }
      if (route.startsWith('/api/v1/streams/')) {
        const user = auth(req); if (!user) fail(401, 'not_authenticated');
        if (route.endsWith('/active') && req.method === 'GET') {
          const stream = db.prepare('SELECT session_id,started_at FROM streams WHERE user_id=? AND stopped_at IS NULL ORDER BY started_at DESC LIMIT 1').get(user.user_id);
          return send(200, { session_id: stream?.session_id ?? null, started_at: stream?.started_at ?? null });
        }
        if (req.method !== 'POST' || !['/api/v1/streams/start', '/api/v1/streams/stop'].includes(route)) fail(404, 'not_found');
        const { session_id: id } = await body(req); if (typeof id !== 'string' || !uuid.test(id)) fail(400, 'invalid_session_id');
        const existing = db.prepare('SELECT * FROM streams WHERE session_id=?').get(id);
        if (existing && existing.user_id !== user.user_id) fail(403, 'not_owner');
        if (route.endsWith('/start')) {
          if (existing?.stopped_at) fail(409, 'session_ended');
          db.prepare('UPDATE streams SET stopped_at=? WHERE user_id=? AND session_id<>? AND stopped_at IS NULL').run(iso(), user.user_id, id);
          db.prepare('INSERT OR IGNORE INTO streams VALUES (?,?,?,NULL)').run(id, user.user_id, iso());
        } else {
          // A stop arriving before a delayed start creates a tombstone; never resurrect it.
          db.prepare('INSERT OR IGNORE INTO streams VALUES (?,?,?,?)').run(id, user.user_id, iso(), iso());
          db.prepare('UPDATE streams SET stopped_at=? WHERE session_id=? AND user_id=?').run(iso(), id, user.user_id);
        }
        return send(200, { session_id: id, status: route.endsWith('/start') ? 'active' : 'stopped' });
      }
      fail(404, 'not_found');
    } catch (error) { send(error.status ?? 500, { error: { code: error.code ?? 'unavailable', message: error.code ?? 'Service unavailable' } }); }
  });
  server.requestTimeout = 10000;
  return { server, db, environment, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lan = process.argv.includes('--lan');
  const port = Number(process.env.NATIVE_FIXTURE_PORT ?? 18063);
  const fixture = createFixture({ database: path.join(appRoot, '.runtime/accounts.sqlite3'), secure: false });
  fixture.server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => console.log(JSON.stringify({ service: 'aether-native-fixture', pid: process.pid, port, host: lan ? '0.0.0.0' : '127.0.0.1', database: '.runtime/accounts.sqlite3', transport: 'private development HTTP only' })));
  process.on('SIGINT', () => { void fixture.close().then(() => process.exit()); });
}
