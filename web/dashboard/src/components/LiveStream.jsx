// Member 2: plays Member 1's MediaMTX stream over WebRTC/WHEP when a session ID is set; otherwise shows the mock scene.
import { useEffect, useRef, useState } from 'react';
import { mediaClient } from '../services/mediaClient.js';
import { Icon, SceneArt } from './ui.jsx';

const RETRY_MS = 3000;

const PILLS = {
  connecting: { className: 'pill-status-connecting', dot: 'dot-connecting', label: 'Connecting' },
  live: { className: 'pill-live', dot: 'dot-online pulse', label: 'LIVE' },
  waiting: { className: 'pill-status-offline', dot: '', label: 'Waiting' },
};

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

export default function LiveStream({ stream, sessionId = null, large = false, detection }) {
  const videoRef = useRef(null);
  const { state, setState, message } = useWhepStream(sessionId, videoRef);
  const pill = sessionId ? PILLS[state] : PILLS.live;

  return (
    <section className={`card live-card${large ? ' live-card-large' : ''}`} aria-labelledby="live-title">
      <div className="card-head">
        <div>
          <h2 id="live-title" className="card-title">Live camera feed</h2>
          <p className="card-sub">
            {sessionId ? `Session ${sessionId.slice(0, 8)} · Phone camera` : `Session 001 · ${stream.device}`}
          </p>
        </div>
        <span className={`pill ${pill.className}`}><span className={`dot ${pill.dot}`} aria-hidden="true" />{pill.label}</span>
      </div>

      <div className="live-stage">
        {sessionId ? (
          <>
            <video ref={videoRef} className="live-video" autoPlay muted playsInline
              onPlaying={() => setState('live')} aria-label="Live video from the phone camera" />
            {state !== 'live' && (
              <div className="live-overlay" role="status">
                <Icon name={state === 'connecting' ? 'wifi' : 'video'} size={22} />
                <p>{state === 'connecting' ? 'Connecting to the phone…' : message}</p>
                {state === 'waiting' && <p className="live-overlay-hint">Trying again every few seconds.</p>}
              </div>
            )}
          </>
        ) : (
          <>
            <SceneArt scene="door" sign="205" label="Mock camera view: a corridor with a door labelled Room 205" />
            {detection && (
              <div className="detection" aria-hidden="true">
                <span className="detection-tag"><span>{detection.label}</span><strong>{detection.value}</strong></span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="live-foot">
        <span className="with-icon"><Icon name="video" size={14} />WebRTC stream</span>
        <span>720p · {stream.fps} fps</span>
        {large
          ? <span>{stream.codec}</span>
          : <a href="#/live" className="link-quiet with-icon"><Icon name="external" size={14} />Expand</a>}
      </div>
    </section>
  );
}
