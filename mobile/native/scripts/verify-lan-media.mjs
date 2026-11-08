// Optional local acceptance: isolated MediaMTX, synthetic SDP only, no camera or account data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLanHost, mediaLanEnvironment } from './lan-host.mjs';
const native = fileURLToPath(new URL('../', import.meta.url)), runtime = path.join(native, '.runtime/history-streaming');
mkdirSync(runtime, { recursive: true });
const { address: host } = selectLanHost(os.networkInterfaces(), process.env.AETHER_LAN_HOST);
const config = path.join(runtime, 'mediamtx-test.json');
writeFileSync(config, JSON.stringify({ logLevel: 'warn', rtsp: false, rtmp: false, hls: false, srt: false, moq: false, playback: false, api: true, apiAddress: '127.0.0.1:19997', webrtc: true, webrtcAddress: '127.0.0.1:18889', paths: { all_others: {} } }));
const child = spawn(path.resolve(native, '../streaming/mediamtx-local/mediamtx.exe'), [config], {
  cwd: runtime, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...mediaLanEnvironment(host), MTX_WEBRTCLOCALUDPADDRESS: `${host}:18189`, MTX_APIADDRESS: '127.0.0.1:19997' },
});
let logs = '', launchError; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; }); child.on('error', error => { launchError = error; });
let resource;
try {
  let active;
  for (let i = 0; i < 50; i++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw Error('Isolated MediaMTX exited; see media-test.log');
    try { active = await fetch('http://127.0.0.1:19997/v3/config/global/get', { signal: AbortSignal.timeout(500) }).then(r => r.json()); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(active?.webrtcLocalUDPAddress, `${host}:18189`); assert.equal(active.webrtcIPsFromInterfaces, false);
  const offer = [
    'v=0', 'o=- 12345 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS test',
    'm=video 9 UDP/TLS/RTP/SAVPF 102', 'c=IN IP4 0.0.0.0', 'a=rtcp:9 IN IP4 0.0.0.0',
    'a=ice-ufrag:synthetic', 'a=ice-pwd:synthetic-password-1234567890', `a=fingerprint:sha-256 ${Array(32).fill('AB').join(':')}`,
    'a=setup:actpass', 'a=mid:0', 'a=sendonly', 'a=msid:test camera', 'a=rtcp-mux',
    'a=rtpmap:102 H264/90000', 'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f', 'a=ssrc:123456 cname:synthetic', '',
  ].join('\r\n');
  const endpoint = `http://127.0.0.1:18889/live/${crypto.randomUUID()}/whip`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer, signal: AbortSignal.timeout(10000) });
  const answer = await response.text(); assert.equal(response.status, 201, answer);
  resource = new URL(response.headers.get('Location'), endpoint).href;
  const candidates = answer.split(/\r?\n/).filter(line => line.startsWith('a=candidate:'));
  assert.ok(candidates.length > 0); for (const candidate of candidates) assert.equal(candidate.split(' ')[4], host);
  const report = { host, candidates, mediaMtxConfigVerified: true, realVideoTested: false };
  writeFileSync(path.join(runtime, 'media-candidates.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (resource) await fetch(resource, { method: 'DELETE', signal: AbortSignal.timeout(3000) }).catch(() => {});
  if (child.exitCode === null && child.pid) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
  writeFileSync(path.join(runtime, 'media-test.log'), logs);
}
