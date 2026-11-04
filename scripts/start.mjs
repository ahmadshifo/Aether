// `npm start`: runs every Aether service inside this one terminal. Ctrl+C stops them all; so does closing the terminal.
// Anything already running is left alone, so it is safe to run this again.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = path.join('.venv', 'Scripts', 'python');
// ahmadshifo's multimedia code needs MySQL 8.4; it runs privately on port 3307, separate from MySQL 8.0 on 3306.
const mysqlDir = process.env.AETHER_MYSQL_DIR ?? path.join(os.homedir(), 'mysql84');

// The phone needs this PC's current Wi-Fi address; home Wi-Fi addresses change.
function wifiAddress() {
  const interfaces = os.networkInterfaces();
  const names = Object.keys(interfaces).sort((a, b) => /wi-?fi/i.test(b) - /wi-?fi/i.test(a));
  for (const name of names) {
    const found = interfaces[name].find(item => item.family === 'IPv4' && !item.internal);
    if (found) return found.address;
  }
  return undefined;
}

const isUp = port => new Promise(resolve => {
  const socket = net.connect({ host: 'localhost', port, timeout: 1000 });
  const finish = up => { socket.destroy(); resolve(up); };
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const host = wifiAddress();

const services = [
  { name: 'mysql', port: 3307, dir: mysqlDir, command: `${path.join('mysql-8.4.13-winx64', 'bin', 'mysqld.exe')} --defaults-file=my.ini --console`, waitFor: true },
  // MTX_API turns on MediaMTX's stream list on this PC only; the interfaces list keeps video on the Wi-Fi
  // instead of the virtual WSL/Hyper-V adapters, which dropped the stream. Neither edits mediamtx.yml.
  { name: 'video', port: 8889, dir: 'mobile/streaming', command: `${path.join('mediamtx-local', 'mediamtx.exe')} mediamtx.yml`, env: { MTX_API: 'yes', MTX_APIADDRESS: '127.0.0.1:9997', MTX_WEBRTCIPSFROMINTERFACESLIST: 'WiFi' } },
  { name: 'voice', port: 8001, dir: 'mobile/voice-service', command: `${python} -m uvicorn app.main:app --port 8001` },
  { name: 'backend', port: 8002, dir: 'web/ai-backend', command: `${python} -m uvicorn app.main:app --host 0.0.0.0 --port 8002` },
  { name: 'multimedia', port: 8003, dir: 'multimedia/api', command: `${python} -m uvicorn app.main:app --port 8003` },
  // HTTPS on the Wi-Fi (vite.phone.config.ts) so a phone browser gets camera access.
  { name: 'phone-web', port: 5173, dir: 'mobile/frontend', command: 'npm run dev -- --config vite.phone.config.ts', url: 'http://localhost:5173' },
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
    cwd: path.resolve(root, service.dir), shell: true,
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
  console.log('Stopping everything...');
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
console.log(host ? `\nPhone: scan the QR code Expo prints, or open exp://${host}:8083. Press Ctrl+C to stop everything.` : '\nNo Wi-Fi address found: connect this PC to Wi-Fi, then run npm start again.');
