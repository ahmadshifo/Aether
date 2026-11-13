// Runs teammates' unchanged Python services using private, mobile-owned config.
// Database credentials are never Expo public variables or command-line arguments.
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { selectLanHost, mediaLanEnvironment } from './lan-host.mjs';
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
function ensureRetention(config, env) {
  const marker = path.join(runtime, 'retention.pid');
  if (existsSync(marker)) {
    const pid = Number(readFileSync(marker, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); console.log('Retention worker is already running.'); return; } catch { /* Stale marker after a previous shutdown. */ }
    }
  }
  const child = launch(config.python, ['-u', '-m', 'database.retention', '--worker', '--execute'], path.join(repo, 'multimedia'), env);
  if (!child.pid) throw Error('Retention worker did not start');
  writeFileSync(marker, String(child.pid));
  child.once('exit', () => { if (existsSync(marker) && readFileSync(marker, 'utf8') === String(child.pid)) unlinkSync(marker); });
  console.log('Frame retention worker enabled: removes expired frames and their RustFS objects every 15 minutes.');
}
try {
  if (mode === 'check') { await check(); }
  else if (mode === 'start' || mode === 'services') {
    const configPath = path.join(runtime, 'local.json');
    if (!existsSync(configPath)) throw Error('Missing private setup: see TEAM-INTEGRATION.md. Configure the MySQL-backed team service first.');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const serverEnv = Object.fromEntries(['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'JWT_SECRET', 'DATABASE_URL', 'FRAME_STORAGE_PATH', 'FRAME_RETENTION_HOURS'].map(key => [key, String(config[key] ?? '')]));
    serverEnv.PYTHONPYCACHEPREFIX = path.join(runtime, 'pycache');
    serverEnv.MULTIMEDIA_API_URL = 'http://127.0.0.1:8003';
    serverEnv.FRAME_STORAGE_BACKEND = config.FRAME_STORAGE_BACKEND ?? 'local';
    serverEnv.MULTIMEDIA_AI_ANALYSIS = config.MULTIMEDIA_AI_ANALYSIS ?? 'off';
    for (const key of ['OPENAI_API_KEY', 'MISTRAL_API_KEY', 'S3_ENDPOINT_URL', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      if (config[key]) serverEnv[key] = String(config[key]);
    }
    if (serverEnv.FRAME_STORAGE_BACKEND === 's3') {
      if (!config.rustfsDir || !existsSync(path.join(config.rustfsDir, 'rustfs.exe'))) throw Error('RustFS is configured but its server is missing. See TEAM-SETUP.md.');
      await ensure(path.join(config.rustfsDir, 'rustfs.exe'), ['server', path.join(config.rustfsDir, 'data')], config.rustfsDir, {
        RUSTFS_ADDRESS: '127.0.0.1:9000', RUSTFS_CONSOLE_ENABLE: 'true', RUSTFS_CONSOLE_ADDRESS: '127.0.0.1:9001',
        RUSTFS_ACCESS_KEY: config.S3_ACCESS_KEY_ID, RUSTFS_SECRET_KEY: config.S3_SECRET_ACCESS_KEY,
      }, 9000);
      await new Promise((resolve, reject) => {
        const child = launch(config.python, ['scripts/team-storage.py', 'check'], native);
        child.once('exit', code => code === 0 ? resolve() : reject(Error('RustFS authenticated bucket check failed'))); child.once('error', reject);
      });
    }
    await ensure(path.join(config.mysqlDir, 'mysql-8.4.13-winx64/bin/mysqld.exe'), [`--defaults-file=${path.join(config.mysqlDir, 'my.ini')}`], config.mysqlDir, {}, Number(config.MYSQL_PORT), true);
    // Validate the exact teammate schema before starting the account service.
    await new Promise((resolve, reject) => {
      const child = launch(config.python, ['-m', 'database.connection', '--check'], path.join(repo, 'multimedia'), serverEnv);
      child.once('exit', code => code === 0 ? resolve() : reject(Error('MySQL/schema verification failed'))); child.once('error', reject);
    });
    await new Promise((resolve, reject) => {
      const child = launch(config.python, ['scripts/prepare-team-history.py'], native, serverEnv);
      child.once('exit', code => code === 0 ? resolve() : reject(Error('Team History table setup failed'))); child.once('error', reject);
    });
    await ensure(config.python, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8002'], path.join(repo, 'web/ai-backend'), serverEnv, 8002);
    await check();
    const { address: host, name: lanInterface } = selectLanHost(os.networkInterfaces(), process.env.AETHER_LAN_HOST);
    console.log(`LAN: ${lanInterface} (${host}). Restart this launcher after changing networks.`);
    const mediaDir = path.join(repo, 'mobile/streaming'), mediaExe = path.join(mediaDir, 'mediamtx-local/mediamtx.exe');
    if (existsSync(mediaExe)) {
      const existing = await listening(8889);
      await ensure(mediaExe, ['mediamtx.yml'], mediaDir, mediaLanEnvironment(host), 8889);
      if (existing) {
        try {
          const active = await fetch('http://127.0.0.1:9997/v3/config/global/get', { signal: AbortSignal.timeout(2000) }).then(r => r.json());
          if (active.webrtcLocalUDPAddress !== `${host}:8189` || active.webrtcIPsFromInterfaces !== false || !active.webrtcAdditionalHosts?.includes(host)) console.warn('Existing MediaMTX uses different ICE settings. Stop its launcher and restart to apply this LAN address.');
        } catch { console.warn('Could not verify the existing MediaMTX LAN configuration.'); }
      }
    }
    else console.log('MediaMTX executable missing; camera publishing remains unavailable.');
    await ensure(config.python, ['-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '8003'], path.join(repo, 'multimedia'), serverEnv, 8003);
    if (config.FRAME_RETENTION_WORKER === true) ensureRetention(config, serverEnv);
    console.log(`Multimedia API and live ingestion: http://127.0.0.1:8003; frame storage: ${serverEnv.FRAME_STORAGE_BACKEND}; AI analysis: ${serverEnv.MULTIMEDIA_AI_ANALYSIS}.`);
    console.log(`Phone backend: http://${host}:8002; media: http://${host}:8889. Save these addresses in Connection.`);
    if (mode === 'start') {
      // Same service entry points as teammates' root launcher, using the verified local environments.
      await ensure(config.python, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8001'], path.join(repo, 'mobile/voice-service'), { VOICE_AUTH_ORIGIN: backend }, 8001);
      const voiceHealth = await fetch('http://127.0.0.1:8001/health', { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
      console.log(`Phone voice server: http://${host}:8001. ${voiceHealth?.service !== 'aether-voice' ? 'Restart the old voice process to load the new service.' : voiceHealth.configured ? 'Keys configured; provider calls still need a live test.' : 'Add free API keys to mobile/voice-service/.env; device voice remains available.'}`);
      await ensure(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], path.join(repo, 'web/dashboard'), {}, 5174);
      await ensure(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], path.join(repo, 'mobile/frontend'), { AUTH_PROXY_TARGET: backend }, 5173);
      console.log('Dashboard: http://127.0.0.1:5174; desktop PWA: http://127.0.0.1:5173.');
      if (await listening(8083)) console.log('Metro is already running on 8083. Restart it if it serves a different checkout.');
      else launch(process.execPath, ['scripts/expo.mjs', 'start', '--dev-client', '--lan', '--port', '8083'], native, { EXPO_PUBLIC_AETHER_HOST: host, EXPO_PUBLIC_AETHER_BACKEND_URL: `http://${host}:8002`, EXPO_PUBLIC_AETHER_MEDIA_URL: `http://${host}:8889`, REACT_NATIVE_PACKAGER_HOSTNAME: host }).once('exit', stop);
    }
    console.log('Ctrl+C stops app services started by this launcher. MySQL and existing services stay running.');
  } else throw Error('Use start, services, or check.');
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
