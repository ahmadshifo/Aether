// Member 2: full-size live view of the phone's camera. Connect finds the stream this account's phone is publishing
// (no link needed) and Disconnect stops watching it; the phone keeps streaming either way.
import { useContext, useEffect, useState } from 'react';
import LiveStream from '../components/LiveStream.jsx';
import PhoneBattery from '../components/PhoneBattery.jsx';
import CaregiverNotes from '../components/CaregiverNotes.jsx';
import { DynamicButton, ScrambleText } from '../components/ui/index.js';
import { Icon, PageHeader, UserContext, formatShortTime } from '../components/ui.jsx';
import { useWatchedSession } from '../components/useWatchedSession.js';
import { useCameraPaused } from '../components/useLiveSessionId.js';
import { useQuestions } from '../components/useBackend.js';

const BUTTON_STATE = { idle: 'busy', connecting: 'busy', waiting: 'busy', live: 'done', paused: 'idle' };

export default function LiveCamera() {
  const user = useContext(UserContext);
  const { watching, looking, notice, liveId, connect, disconnect } = useWatchedSession(user?.email);
  const paused = useCameraPaused(watching);
  const [streamState, setStreamState] = useState('idle');
  const [revealKey, setRevealKey] = useState(0);
  const [size, setSize] = useState(null); // [width, height] of the video actually arriving
  const history = useQuestions();
  const question = history.questions[0];

  useEffect(() => { if (watching) setRevealKey((n) => n + 1); }, [watching]);

  const buttonState = looking ? 'busy' : watching ? BUTTON_STATE[streamState] : 'idle';
  const playing = Boolean(watching) && streamState === 'live';
  const facts = [
    ['Protocol', 'WebRTC (WHEP) from MediaMTX'],
    ['Resolution', playing && size ? `${size[0]} × ${size[1]}` : '—'],
    ['Status', !watching ? 'Not watching' : playing ? 'Receiving video' : streamState === 'paused' ? 'Camera paused on the phone' : 'Connecting'],
  ];

  return (
    <>
      <PageHeader eyebrow="Monitoring / Live camera" title="Live camera" subtitle="What the phone camera is seeing right now." />

      <div className="grid grid-live">
        <section className="card section section-tight live-panel" aria-label="Live stream">
          <LiveStream sessionId={watching} aspect="16x10" full onState={setStreamState} paused={paused}
            onSize={(width, height) => setSize(width && height ? [width, height] : null)}
            idleText={liveId ? 'Your phone is streaming. Press Connect to watch it.' : 'Press Connect to watch the phone’s camera.'} />
          <div className="under-stage">
            {question ? (
              <span>
                <span className="label">Last question · {formatShortTime(question.asked_at)}</span>
                <span className="last-question" lang={question.language} dir="auto">“{question.question}”</span>
              </span>
            ) : (
              <span className="label">{history.loading ? 'Loading the last question…' : 'No questions yet'}</span>
            )}
          </div>
        </section>

        <div className="stack">
          <section className="card section" aria-labelledby="session-title">
            <div className="card-head">
              <h2 id="session-title" className="card-title">Stream session</h2>
              <PhoneBattery />
            </div>
            <div className="session-field inset">
              {watching ? (
                <ScrambleText className="session-path" text={`live/${watching}`} runKey={revealKey}
                  charset="hex" step={1.2} tick={40} keepPrefix={5} />
              ) : (
                <span className="session-path muted">{liveId ? 'Your phone is streaming' : 'Waiting for your phone'}</span>
              )}
            </div>
            {notice && <p className="note" role="status"><Icon name="alert" size={16} />{notice}</p>}
            <div className="btn-row">
              <DynamicButton state={buttonState} onClick={connect} disabled={Boolean(watching) || looking}
                labels={{ idle: 'Connect', busy: 'Connecting…', done: 'Connected' }} />
              <button type="button" className="btn" onClick={disconnect} disabled={!watching && !looking}>Disconnect</button>
            </div>
            <p className="hint">
              Sign in to the Aether app on the phone with this same account and press Start. Connect then shows its camera
              here; Disconnect stops watching without stopping the phone.
            </p>
            <dl className="facts">
              {facts.map(([term, detail]) => (
                <div key={term} className="inset"><dt className="label">{term}</dt><dd>{detail}</dd></div>
              ))}
            </dl>
          </section>

          <CaregiverNotes />
        </div>
      </div>
    </>
  );
}
