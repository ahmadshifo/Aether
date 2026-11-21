// Member 2: plays Member 1's MediaMTX stream over WebRTC/WHEP when a session ID is set; otherwise says no phone is streaming.
import { useEffect, useRef, useState } from 'react';
import { mediaClient } from '../services/mediaClient.js';
import { LiveDot, LogoTraceLoader } from './ui/index.js';

const RETRY_MS = 3000;

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
// onState gets 'idle' (no session), 'connecting', 'waiting' or 'live'. idleText is shown when there's no stream.
// paused: the user said "camera off" on the phone; the stream is gone on purpose, so say that instead of retrying.
export default function LiveStream({ sessionId = null, aspect = '16x9', full = false, idleText, onState, onSize, paused = false }) {
  const videoRef = useRef(null);
  const { state, setState, message } = useWhepStream(paused ? null : sessionId, videoRef);
  const playing = Boolean(sessionId) && !paused && state === 'live';
  const clock = useLiveClock(playing);

  useEffect(() => { onState?.(sessionId ? (paused ? 'paused' : state) : 'idle'); }, [sessionId, state, paused, onState]);

  return (
    <div className={`stage stage-${aspect}`}>
      {sessionId && (
        <video ref={videoRef} autoPlay muted playsInline onPlaying={() => setState('live')}
          onResize={(event) => onSize?.(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
          aria-label="Live video from the phone camera" />
      )}

      {sessionId && paused && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={56} strokeWidth={1.2} />
          <p>Camera paused by the user.</p>
          <span className="label">The user said “camera off”. The voice assistant still works; the video returns when they say “camera on”.</span>
        </div>
      )}
      {sessionId && !paused && state === 'connecting' && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={72} loop strokeWidth={1.2} />
          <span className="label">Connecting to the phone…</span>
        </div>
      )}
      {sessionId && !paused && state === 'waiting' && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={56} strokeWidth={1.2} />
          <p>{message}</p>
          <span className="label">Trying again every few seconds</span>
        </div>
      )}

      {!sessionId && (
        <div className="stage-overlay" role="status">
          <LogoTraceLoader size={56} strokeWidth={1.2} />
          <p>{idleText ?? 'No phone is streaming.'}</p>
        </div>
      )}

      {playing && (
        <span className="stage-chip chip-tl"><LiveDot />LIVE {clock}</span>
      )}
      {full && <span className="stage-chip chip-tr">MIC ON</span>}
      {full && <span className="stage-chip stage-chip-plain chip-br">Faces are never identified</span>}
    </div>
  );
}
