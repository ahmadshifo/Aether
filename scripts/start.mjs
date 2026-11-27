// `npm start`: starts Docker dependencies and app services. Ctrl+C stops owned app processes; Docker persists.
// Anything already running is left alone, so it is safe to run this again.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLanHost, mediaLanEnvironment } from '../mobile/native/scripts/lan-host.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = path.join('.venv', 'Scripts', 'python');
if (!fs.existsSync(path.join(root, '.env'))) {
  console.error('Run node scripts/configure-local.mjs first. See docs/SETUP.md.'); process.exit(1);
}
// Node's parser handles quoted secrets without printing them; process settings win.
process.loadEnvFile(path.join(root, '.env'));

const isUp = port => new Promise(resolve => {
  const socket = net.connect({ host: 'localhost', port, timeout: 1000 });
  const finish = up => { socket.destroy(); resolve(up); };
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lan = selectLanHost(os.networkInterfaces(), process.env.AETHER_LAN_HOST || undefined);
const host = lan.address;

async function dockerReady() {
  for (const port of [Number(process.env.MYSQL_PORT || 3307), 9000, 8001]) {
    if (!await isUp(port)) continue;
    const managed = spawnSync('docker', ['compose', 'ps', '--format', 'json'], { cwd: root, encoding: 'utf8' });
    if (managed.status !== 0 || !managed.stdout.includes(`\"PublishedPort\":${port}`) && !managed.stdout.includes(`\"PublishedPort\": ${port}`)) {
      throw Error(`Port ${port} is already used outside this Compose stack. Stop that service yourself before switching; its data will be kept.`);
    }
  }
  console.log('Starting Docker storage and local voice. First model download can take several minutes.');
  const result = await new Promise(resolve => {
    const args = ['compose', 'up', '-d', ...(process.argv.includes('--build-services') ? ['--build'] : [])];
    const child = spawn('docker', args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', () => resolve(1)); child.once('exit', resolve);
  });
  if (result !== 0) throw Error('Docker services could not start. Check Docker Desktop and docker compose logs.');
  // Compose --wait treats a successful one-shot initializer as an exited service.
  // Check it separately from the four long-running healthchecks.
  const deadline = Date.now() + 2400000;
  for (;;) {
    const status = spawnSync('docker', ['compose', 'ps', '--all', '--format', 'json'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (status.status !== 0) throw Error('Could not inspect Docker healthchecks.');
    const raw = status.stdout.trim();
    const entries = raw.startsWith('[') ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const states = new Map(entries.map(item => [item.Service, item]));
    const init = states.get('storage-init');
    const workers = ['mysql', 'rustfs', 'voice-stt', 'voice-tts'].map(name => states.get(name));
    if (init?.State === 'exited' && init.ExitCode !== 0 || workers.some(item => item?.Health === 'unhealthy' || item?.State === 'exited')) {
      throw Error('A Docker worker or storage initializer failed. Inspect docker compose logs.');
    }
    if (init?.State === 'exited' && init.ExitCode === 0 && workers.every(item => item?.Health === 'healthy')) break;
    if (Date.now() > deadline) throw Error('Model startup exceeded 40 minutes. Downloads remain running; inspect logs and retry after they finish.');
    console.log('Waiting for Docker model/storage healthchecks...');
    await sleep(15000);
  }
  const init = spawnSync(path.join(root, 'multimedia/api', python), ['-m', 'database.connection', '--init'], {
    cwd: path.join(root, 'multimedia'), stdio: 'inherit', env: process.env,
  });
  if (init.status !== 0) throw Error('Schema readiness failed. Install multimedia dependencies and review its diagnostic. Existing rows were not deleted.');
}
try { await dockerReady(); } catch (error) { console.error(error.message); process.exit(1); }

const services = [
  // MTX_API turns on MediaMTX's stream list on this PC only; the interfaces list keeps video on the Wi-Fi
  // instead of the virtual WSL/Hyper-V adapters, which dropped the stream. Neither edits mediamtx.yml.
  { name: 'video', port: 8889, dir: 'mobile/streaming', command: `${path.join('mediamtx-local', 'mediamtx.exe')} mediamtx.yml`, env: mediaLanEnvironment(host) },
  { name: 'backend', port: 8002, dir: 'web/ai-backend', command: `${python} -m uvicorn app.main:app --host 0.0.0.0 --port 8002` },
  // ahmadshifo's API (api.main) runs from multimedia/ with the api/.venv environment; it also reads phone streams.
  { name: 'multimedia', port: 8003, dir: 'multimedia', command: `${path.join('api', python)} -m uvicorn api.main:app --port 8003` },
  { name: 'dashboard', port: 5174, dir: 'web/dashboard', command: 'npm run dev', url: 'http://localhost:5174' },
  // The development build gets the address here, so nothing has to be typed on the phone. It keeps the terminal itself:
  // that is what makes it print the QR code and read its keys. Started without npm so Ctrl+C doesn't ask "Terminate batch job?".
  { name: 'expo', port: 8083, dir: 'mobile/native', command: 'node scripts/expo.mjs start --dev-client --lan --port 8083', env: host && { EXPO_PUBLIC_AETHER_HOST: host, REACT_NATIVE_PACKAGER_HOSTNAME: host }, ownsTerminal: true },
];

// Labels each line of a service's output with its name.
function labelled(name, stream, output) {
  let partial = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) if (line.trim()) output.write(`[${name}] ${line}\n`);
  });
}

const running = new Map();
function run(service) {
  const child = spawn(service.command, {
    cwd: path.resolve(root, service.dir), shell: true, windowsHide: true,
    stdio: service.ownsTerminal ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...service.env },
  });
  running.set(service.name, child);
  if (!service.ownsTerminal) {
    labelled(service.name, child.stdout, process.stdout);
    labelled(service.name, child.stderr, process.stderr);
  }
  child.once('exit', code => {
    running.delete(service.name);
    console.log(`[${service.name}] stopped (exit code ${code})`);
    // Expo reads Ctrl+C itself as a key, so no signal reaches this script: its clean exit means the user pressed it.
    if (service.ownsTerminal && code === 0) stopAll();
  });
}

function stopAll() {
  console.log('Stopping app processes. Docker data and voice stay available; docker compose stop stops them safely.');
  for (const child of running.values()) spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  process.exit(0);
}
process.on('SIGINT', stopAll);

const toOpen = [];
for (const service of services) {
  const label = `${service.name} (port ${service.port})`;
  if (await isUp(service.port)) { console.log(`already running: ${label}`); continue; }
  if (service.url) toOpen.push(service.url);
  // Expo goes last and only after the websites, because it takes over the screen.
  if (service.ownsTerminal && toOpen.length) await sleep(6000);
  for (const url of service.ownsTerminal ? toOpen.splice(0) : []) spawn(`start "" ${url}`, { shell: true, stdio: 'ignore' });
  console.log(`starting: ${label}`);
  run(service);
  // The AI backend needs MySQL as soon as it starts.
  if (service.waitFor) {
    for (let tries = 0; tries < 30 && !(await isUp(service.port)); tries++) await sleep(1000);
  }
}

for (const url of toOpen) spawn(`start "" ${url}`, { shell: true, stdio: 'ignore' });
if (!running.size) { console.log('\nEverything is already running in another terminal. Press Ctrl+C there to stop it.'); process.exit(0); }
console.log(host ? `\nPhone: scan Expo's QR code or enter http://${host}:8083 in the development launcher. Ctrl+C stops app services; docker compose stop stops Docker services.` : '\nNo Wi-Fi address found: connect this PC to Wi-Fi, then run npm start again.');
