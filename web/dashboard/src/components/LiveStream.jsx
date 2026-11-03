// Member 2: plays Member 1's MediaMTX stream over WebRTC/WHEP when a session ID is set; otherwise shows the stand-in scene.
import { useEffect, useRef, useState } from 'react';
import { mediaClient } from '../services/mediaClient.js';
import { LiveDot, LogoTraceLoader } from './ui/index.js';
import { SceneArt } from './ui.jsx';

const RETRY_MS = 3000;
const MOCK_CLOCK = '00:32:14';

// Connects to the stream and keeps retrying while the phone hasn't started or drops out.
function useWhepStream(sessionId, videoRef) {
  const [state, setState] = useState('connecting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!sessionId) return undefined;
    let player = null;
    let retryTimer;
    let cancelled = false;

    const retry = (text) => {
      if (cancelled) return;
      setState('waiting');
      setMessage(text);
      retryTimer = window.setTimeout(connect, RETRY_MS);
    };

    async function connect() {
      setState('connecting');
      try {
        const started = await mediaClient.play(sessionId, videoRef.current, () => retry('The phone stopped streaming.'));
        if (cancelled) started.stop();
        else player = started;
      } catch (error) {
        retry(error.message);
      }
    }

    connect();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      player?.stop();
    };
  }, [sessionId, videoRef]);

  return { state, setState, message };
}

// hh:mm:ss since the video started playing.
function useLiveClock(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return undefined;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0')).join(':');
}

// aspect: '16x9' (Overview) or '16x10' (Live camera). full adds the MIC ON and privacy chips.
// onState gets 'idle' (no session), 'connecting', 'waiting' or 'live'.
export default function LiveStream({ sessionId = null, aspect = '16x9', full = false, onState }) {
  const videoRef = useRef(null);
  const { state, setState, message } = useWhepStream(sessionId, videoRef);
  const playing = Boolean(sessionId) && state === 'live';
  const clock = useLiveClock(playing);

  useEffect(() => { onState?.(sessionId ? state : 'idle'); }, [sessionId, state, onState]);

  return (
    <div className={`stage stage-${aspect}`}>
      {sessionId ? (
        <video ref={videoRef} autoPlay muted playsInline onPlaying={() => setState('live')}
          aria-label="Live video from the phone camera" />
      ) : (
        <SceneArt scene="door" sign="ROOM 205" label="Stand-in camera view: a corridor door with a ROOM 205 sign" />
      )}

      {sessionId && state === 'connecting' && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={72} loop strokeWidth={1.2} />
          <span className="label">Connecting to the phone…</span>
        </div>
      )}
      {sessionId && state === 'waiting' && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={56} strokeWidth={1.2} />
          <p>{message}</p>
          <span className="label">Trying again every few seconds</span>
        </div>
      )}

      {(playing || !sessionId) && (
        <span className="stage-chip chip-tl"><LiveDot />LIVE {sessionId ? clock : MOCK_CLOCK}</span>
      )}
      {full && <span className="stage-chip chip-tr">MIC ON</span>}
      {full && <span className="stage-chip stage-chip-plain chip-br">Faces are never identified</span>}
    </div>
  );
}
