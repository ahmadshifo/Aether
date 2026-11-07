// Runs teammates' unchanged Python services using private, mobile-owned config.
// Database credentials are never Expo public variables or command-line arguments.
import { readFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const native = fileURLToPath(new URL('../', import.meta.url)), repo = path.resolve(native, '../..');
const runtime = path.join(native, '.runtime/team-integration');
const mode = process.argv[2] ?? 'start';
const backend = process.env.AETHER_BACKEND_URL ?? 'http://127.0.0.1:8002';
async function check() {
  const response = await fetch(`${backend}/api/v1/auth/me`, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  if (response.status !== 401 || body?.error?.code !== 'not_authenticated') throw Error('Shared account service unavailable or unrecognized');
  const schema = await fetch(`${backend}/openapi.json`, { redirect: 'error', signal: AbortSignal.timeout(5000) }).then(r => r.json());
  console.log(`Shared account service reachable: ${backend}`);
  for (const [route, method] of [['/api/v1/auth/me', 'patch'], ['/api/v1/streams/start', 'post'], ['/api/v1/streams/active', 'get'], ['/api/v1/ask', 'post'], ['/api/v1/questions', 'get']]) console.log(`${method.toUpperCase()} ${route}: ${schema.paths?.[route]?.[method] ? 'available' : 'not implemented'}`);
  console.log('Route checks do not prove AI answers, camera transport, or database persistence.');
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const listening = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
  const finish = result => { socket.destroy(); resolve(result); };
  socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.once('timeout', () => finish(false));
});
const children = new Set();
function launch(command, args, cwd, env = {}, persistent = false) {
  const child = spawn(command, args, { cwd, windowsHide: true, detached: persistent, stdio: persistent ? 'ignore' : 'inherit', env: { ...process.env, ...env } });
  if (persistent) child.unref(); else children.add(child);
  child.on('exit', () => children.delete(child)); child.on('error', error => console.error(error.message)); return child;
}
function stop() {
  for (const child of children) {
    // Windows venv/Expo launchers have child processes of their own.
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}
process.on('SIGINT', () => { stop(); process.exit(); }); process.on('SIGTERM', () => { stop(); process.exit(); });
async function ensure(command, args, cwd, env, port, persistent = false) {
  if (await listening(port)) { console.log(`Port ${port} already running; leaving its process alone.`); return; }
  const child = launch(command, args, cwd, env, persistent);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw Error(`Service on port ${port} exited`);
    if (await listening(port)) return;
    await wait(500);
  }
  throw Error(`Service on port ${port} did not start`);
}
try {
  if (mode === 'check') { await check(); }
  else if (mode === 'start' || mode === 'services') {
    const configPath = path.join(runtime, 'local.json');
    if (!existsSync(configPath)) throw Error('Missing private setup: see TEAM-INTEGRATION.md. Configure the MySQL-backed team service first.');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const serverEnv = Object.fromEntries(['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'JWT_SECRET', 'DATABASE_URL', 'FRAME_STORAGE_PATH', 'FRAME_RETENTION_HOURS'].map(key => [key, String(config[key] ?? '')]));
    serverEnv.PYTHONPYCACHEPREFIX = path.join(runtime, 'pycache');
    await ensure(path.join(config.mysqlDir, 'mysql-8.4.13-winx64/bin/mysqld.exe'), [`--defaults-file=${path.join(config.mysqlDir, 'my.ini')}`], config.mysqlDir, {}, Number(config.MYSQL_PORT), true);
    // Validate the exact teammate schema before starting the account service.
    await new Promise((resolve, reject) => {
      const child = launch(config.python, ['-m', 'database.connection', '--check'], path.join(repo, 'multimedia'), serverEnv);
      child.once('exit', code => code === 0 ? resolve() : reject(Error('MySQL/schema verification failed'))); child.once('error', reject);
    });
    await ensure(config.python, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8002'], path.join(repo, 'web/ai-backend'), serverEnv, 8002);
    await check();
    const interfaces = Object.entries(os.networkInterfaces()).sort(([a], [b]) => Number(/wi-?fi/i.test(b)) - Number(/wi-?fi/i.test(a)));
    const host = process.env.AETHER_LAN_HOST || interfaces.flatMap(([, entries]) => entries ?? []).find(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))?.address;
    if (!host) throw Error('No LAN IPv4 address. Set AETHER_LAN_HOST to this laptop’s Wi-Fi address.');
    const mediaDir = path.join(repo, 'mobile/streaming'), mediaExe = path.join(mediaDir, 'mediamtx-local/mediamtx.exe');
    if (existsSync(mediaExe)) await ensure(mediaExe, ['mediamtx.yml'], mediaDir, { MTX_WEBRTCADDITIONALHOSTS: host, MTX_API: 'yes', MTX_APIADDRESS: '127.0.0.1:9997' }, 8889);
    else console.log('MediaMTX executable missing; camera publishing remains unavailable.');
    console.log(`Phone backend: http://${host}:8002; media: http://${host}:8889. Save these addresses in Connection.`);
    if (mode === 'start') {
      if (await listening(8083)) console.log('Metro is already running on 8083. Restart it if it serves a different checkout.');
      else launch(process.execPath, ['scripts/expo.mjs', 'start', '--dev-client', '--lan', '--port', '8083'], native, { EXPO_PUBLIC_AETHER_HOST: host, EXPO_PUBLIC_AETHER_BACKEND_URL: `http://${host}:8002`, EXPO_PUBLIC_AETHER_MEDIA_URL: `http://${host}:8889`, REACT_NATIVE_PACKAGER_HOSTNAME: host }).once('exit', stop);
    }
    console.log('Ctrl+C stops app services started by this launcher. MySQL and existing services stay running.');
  } else throw Error('Use start, services, or check.');
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
