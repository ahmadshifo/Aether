// Direct encrypted WebRTC audio; the backend relays signaling only.
export async function requestCall(path, body, method = 'POST') {
  const response = await fetch('/api/v1/live-voice' + path, { method, credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error?.message ?? 'Live voice is unavailable.');
  return value;
}

export class LiveVoiceSender {
  generation = 0;
  constructor(onState, onLevel) { this.onState = onState; this.onLevel = onLevel; }
  async start() {
    this.stop(false);
    const generation = ++this.generation, current = () => generation === this.generation;
    this.offline = () => { if (current()) this.fail('Connection lost. Press Start to reconnect.'); };
    window.addEventListener('offline', this.offline);
    this.onState('Connecting', '');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices) throw Error('Use localhost or HTTPS to enable the microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const active = await fetch('/api/v1/streams/active').then(r => r.json());
      if (!current()) return;
      if (!active.session) throw Error('Ask the phone user to start an Aether session first.');
      const call = await requestCall('/start', { session_id: active.session.session_id });
      if (!current()) { void requestCall('/' + call.call_id + '/end').catch(() => {}); return; }
      this.call = call;
      const peer = this.peer = new RTCPeerConnection({ iceServers: [] });
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      this.context = new AudioContext(); await this.context.resume();
      const analyser = this.context.createAnalyser(); analyser.fftSize = 256;
      this.context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(256);
      const meter = () => { if (!current()) return; analyser.getByteTimeDomainData(data);
        this.onLevel(Math.min(1, Math.sqrt(data.reduce((sum,v) => sum + ((v-128)/128)**2,0)/256)*4));
        this.frame = requestAnimationFrame(meter); };
      meter();
      const ws = this.socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/v1/live-voice/signal');
      const send = value => { if (current() && ws.readyState === 1) ws.send(JSON.stringify(value)); };
      const candidates = [];
      peer.onicecandidate = event => { if (event.candidate) send({ type: 'ice', candidate: event.candidate.toJSON() }); };
      peer.onconnectionstatechange = () => {
        if (!current()) return;
        if (peer.connectionState === 'connected') { clearTimeout(this.deadline); this.onState('Live', ''); }
        if (['failed','disconnected','closed'].includes(peer.connectionState)) this.fail('Connection lost. Press Start to reconnect.');
      };
      let lastPong = Date.now();
      ws.onopen = () => { send(call); this.ping = setInterval(() => { if (Date.now()-lastPong>25000) this.fail('Connection lost. Press Start to reconnect.'); else send({ type: 'ping' }); }, 10000); };
      ws.onmessage = async event => {
        try {
          if (!current()) return;
          const message = JSON.parse(event.data);
          if (message.type === 'pong') lastPong = Date.now();
          if (message.type === 'ready') { const offer = await peer.createOffer(); if (!current()) return; await peer.setLocalDescription(offer); send({ type: 'offer', sdp: offer.sdp }); }
          if (message.type === 'answer') { await peer.setRemoteDescription({ type: 'answer', sdp: message.sdp }); for (const candidate of candidates.splice(0)) await peer.addIceCandidate(candidate); }
          if (message.type === 'ice') { if (peer.remoteDescription) await peer.addIceCandidate(message.candidate); else candidates.push(message.candidate); }
        } catch { if (current()) this.fail('Could not connect audio. Press Start to retry.'); }
      };
      ws.onclose = event => { if (current()) { this.stop(false); this.onState(event.code === 1000 ? 'Ended' : 'Failed', 'The call ended. Press Start to reconnect.'); } };
      ws.onerror = () => { if (current()) this.fail('Live voice connection failed.'); };
      this.deadline = setTimeout(() => { if (current()) this.fail('The phone did not connect. Check its session and network.'); }, 30000);
    } catch (error) {
      if (!current()) return;
      this.fail(error.name === 'NotAllowedError' ? 'Microphone permission denied. Allow it in browser settings.' :
        error.name === 'NotFoundError' ? 'No microphone found. Connect a microphone and retry.' : error.message);
    }
  }
  fail(message) { this.stop(false); this.onState('Failed', message); }
  stop(notify = true) {
    this.generation++;
    if (this.offline) window.removeEventListener('offline', this.offline);
    clearInterval(this.ping); clearTimeout(this.deadline); cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.socket?.close(); this.socket = null; this.peer?.close(); this.peer = null;
    void this.context?.close().catch(() => {}); this.context = null; this.onLevel(0);
    if (this.call) void requestCall('/' + this.call.call_id + '/end').catch(() => {});
    this.call = null;
    if (notify) this.onState('Ended', '');
  }
}
