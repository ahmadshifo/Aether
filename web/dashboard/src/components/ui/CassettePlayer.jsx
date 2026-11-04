// Member 2: Cassette Audio Player: plays the spoken answer (MP3 from /api/v1/voice/synthesize); the reels turn while it plays.
import { useEffect, useRef, useState } from 'react';
import { voiceClient } from '../../services/voiceClient.js';

const clock = (seconds) => {
  const whole = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function Reel({ radius, spoke }) {
  return (
    <svg width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
      <g className="reel">
        <circle cx="31" cy="31" r={radius} fill="#E8E2D4" />
        <circle cx="31" cy="31" r="9" fill="#111214" />
        <path d={spoke} stroke="#111214" strokeWidth="4" />
      </g>
    </svg>
  );
}

export default function CassettePlayer({ text, language, stamp }) {
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | paused | error
  const [error, setError] = useState('');
  const [time, setTime] = useState({ current: 0, duration: 0 });

  // A different answer is a fresh tape: stop and forget the old recording.
  useEffect(() => {
    setStatus('idle');
    setError('');
    setTime({ current: 0, duration: 0 });
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [text, language]);

  async function toggle() {
    const audio = audioRef.current;
    if (status === 'playing') {
      audio.pause();
      return;
    }
    if (!urlRef.current) {
      setStatus('loading');
      setError('');
      try {
        urlRef.current = await voiceClient.synthesize(text, language);
        audio.src = urlRef.current;
      } catch (err) {
        setStatus('error');
        setError(err.message);
        return;
      }
    }
    try {
      await audio.play();
    } catch {
      setStatus('error');
      setError('The browser blocked playback. Press play again.');
    }
  }

  const playing = status === 'playing';
  const percent = time.duration ? Math.min(100, (time.current / time.duration) * 100) : 0;

  return (
    <>
      <div className={`cassette${playing ? ' is-playing' : ''}`}>
        <div className="cassette-label"><span>SIDE A · SPOKEN ANSWER</span><span>{stamp}</span></div>
        <div className="cassette-window" aria-hidden="true">
          <Reel radius={28} spoke="M31 5v13M31 44v13M5 31h13M44 31h13" />
          <Reel radius={20} spoke="M31 11v9M31 42v9M11 31h9M42 31h9" />
        </div>
        <div className="cassette-controls">
          <button type="button" className="cassette-play" onClick={toggle} disabled={status === 'loading'}
            aria-label={status === 'loading' ? 'Loading the spoken answer' : playing ? 'Pause answer' : 'Play answer'}>
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
            )}
          </button>
          <span className="cassette-track" role="progressbar" aria-label="Playback position"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="cassette-clock">{clock(time.current)} / {clock(time.duration)}</span>
        </div>
        <audio ref={audioRef} preload="none"
          onPlay={() => setStatus('playing')}
          onPause={() => setStatus((s) => (s === 'playing' ? 'paused' : s))}
          onEnded={() => setStatus('paused')}
          onLoadedMetadata={(e) => setTime({ current: 0, duration: e.currentTarget.duration })}
          onTimeUpdate={(e) => setTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration })} />
      </div>
      {error && <p className="cassette-error" role="alert">{error}</p>}
    </>
  );
}
