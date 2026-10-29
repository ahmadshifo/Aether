// Member 2: watches Member 1's MediaMTX stream over WebRTC/WHEP and remembers the session ID typed on the Live Camera page.
const WHEP_BASE = import.meta.env.VITE_MEDIA_WHEP_BASE_URL ?? 'http://localhost:8889';
const SESSION_KEY = 'echosight.liveSessionId';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Wait until the browser has listed its network candidates, so one POST carries the full offer.
function waitForIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
    // Send whatever was gathered after 3 s; local networks finish well before that.
    const timeout = window.setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

export const mediaClient = {
  // Accepts a bare UUID, a "live/<uuid>" path or a whole MediaMTX log line.
  parseSessionId(text) {
    return text.match(UUID_PATTERN)?.[0].toLowerCase() ?? null;
  },

  streamPath(sessionId) {
    return `live/${sessionId}/whep`;
  },

  savedSessionId() {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },

  saveSessionId(sessionId) {
    try {
      if (sessionId) window.localStorage.setItem(SESSION_KEY, sessionId);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // Storage can be blocked (private window); the ID then lasts until reload.
    }
  },

  // Starts receiving the stream into videoElement. Resolves to { stop }; onLost fires if the phone disconnects.
  async play(sessionId, videoElement, onLost) {
    const url = `${WHEP_BASE}/${this.streamPath(sessionId)}`;
    const pc = new RTCPeerConnection();
    let resourceUrl = null;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      pc.close();
      if (resourceUrl) void fetch(resourceUrl, { method: 'DELETE' }).catch(() => {});
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (event) => {
      videoElement.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    };
    pc.onconnectionstatechange = () => {
      if (!stopped && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        stop();
        onLost?.();
      }
    };

    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);

      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription?.sdp ?? '',
        });
      } catch {
        throw new Error("Can't reach MediaMTX. Is it running on port 8889?");
      }
      if (response.status === 404) throw new Error('No live stream for this session ID yet.');
      if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`);

      const location = response.headers.get('Location');
      if (location) resourceUrl = new URL(location, url).toString();
      await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    } catch (error) {
      stop();
      throw error;
    }

    return { stop };
  },
};
