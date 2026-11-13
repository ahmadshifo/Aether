// Member 2: full-size live view of the phone's camera. Connect finds the stream this account's phone is publishing
// (no link needed) and Disconnect stops watching it; the phone keeps streaming either way.
import { useContext, useEffect, useState } from 'react';
import { AUTH_ENABLED } from '../auth.js';
import LiveStream from '../components/LiveStream.jsx';
import { DynamicButton, MagneticDropZone, ScrambleText } from '../components/ui/index.js';
import { Icon, PageHeader, UserContext, formatShortTime } from '../components/ui.jsx';
import { useWatchedSession } from '../components/useWatchedSession.js';
import { useCameraPaused } from '../components/useLiveSessionId.js';
import { useQuestions } from '../components/useBackend.js';
import { STREAM } from '../data/mockData.js';

const BUTTON_STATE = { idle: 'busy', connecting: 'busy', waiting: 'busy', live: 'done' };

export default function LiveCamera() {
  const user = useContext(UserContext);
  const { watching, looking, notice, liveId, connect, disconnect } = useWatchedSession(user?.email);
  const paused = useCameraPaused(watching);
  const [streamState, setStreamState] = useState('idle');
  const [revealKey, setRevealKey] = useState(0);
  const history = useQuestions();
  const question = history.questions[0];

  useEffect(() => { if (watching) setRevealKey((n) => n + 1); }, [watching]);

  const buttonState = looking ? 'busy' : watching ? BUTTON_STATE[streamState] : 'idle';
  const facts = [
    ['Protocol', STREAM.protocol],
    ['Resolution', STREAM.resolution],
    ['Frame rate', `${STREAM.fps} fps`],
    ['Codec', STREAM.codec],
  ];

  return (
    <>
      <PageHeader eyebrow="Monitoring / Live camera" title="Live camera" subtitle="What the phone camera is seeing right now." />

      <div className="grid grid-live">
        <section className="card section section-tight live-panel" aria-label="Live stream">
          <LiveStream sessionId={watching} aspect="16x10" full onState={setStreamState} paused={paused}
            idleText={AUTH_ENABLED
              ? (liveId ? 'Your phone is streaming. Press Connect to watch it.' : 'Press Connect to watch the phone’s camera.')
              : undefined} />
          <div className="under-stage">
            {question ? (
              <span>
                <span className="label">Last question · {formatShortTime(question.asked_at)}{history.demo ? ' · demo' : ''}</span>
                <span className="last-question" lang={question.language} dir="auto">“{question.question}”</span>
              </span>
            ) : (
              <span className="label">{history.loading ? 'Loading the last question…' : 'No questions yet'}</span>
            )}
          </div>
        </section>

        <div className="stack">
          <section className="card section" aria-labelledby="session-title">
            <h2 id="session-title" className="card-title">Stream session</h2>
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

          <section className="card section section-tight" aria-labelledby="drop-title">
            <div>
              <h2 id="drop-title" className="card-title">Test with a recorded video</h2>
              <p className="sub">No phone? Drop an MP4 and the memory pipeline reads it like a live stream.</p>
            </div>
            <MagneticDropZone />
          </section>
        </div>
      </div>
    </>
  );
}
