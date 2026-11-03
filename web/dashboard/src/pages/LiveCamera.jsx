// Member 2: full-size live view of the phone's camera. Connect finds the stream this account's phone is publishing: no link needed.
import { useContext, useEffect, useRef, useState } from 'react';
import { AUTH_ENABLED } from '../auth.js';
import LiveStream from '../components/LiveStream.jsx';
import { DynamicButton, MagneticDropZone, ScrambleText } from '../components/ui/index.js';
import { Icon, PageHeader, UserContext, formatShortTime } from '../components/ui.jsx';
import { findLiveSessionId, useLiveSessionId } from '../components/useLiveSessionId.js';
import { QUESTIONS, STREAM } from '../data/mockData.js';

const BUTTON_STATE = { idle: 'busy', connecting: 'busy', waiting: 'busy', live: 'done' };

export default function LiveCamera() {
  const user = useContext(UserContext);
  const liveId = useLiveSessionId();
  const [watching, setWatching] = useState(null); // the session being played; null = not connected
  const [looking, setLooking] = useState(false);
  const [streamState, setStreamState] = useState('idle');
  const [notice, setNotice] = useState('');
  const [revealKey, setRevealKey] = useState(0);
  const watchingRef = useRef(null);
  watchingRef.current = watching;
  const question = QUESTIONS[0];

  // Follow the phone while connected: a new session after Stop and Start is picked up; Stop disconnects.
  useEffect(() => {
    const current = watchingRef.current;
    if (!current || liveId === undefined) return;
    if (liveId === null) {
      setWatching(null);
      setNotice('The phone stopped streaming. Press Connect when it starts again.');
    } else if (liveId !== current) {
      setWatching(liveId);
      setRevealKey((n) => n + 1);
    }
  }, [liveId]);

  async function connect() {
    if (watching) {
      setWatching(null);
      setNotice('');
      return;
    }
    setLooking(true);
    setNotice('');
    const id = await findLiveSessionId();
    setLooking(false);
    if (!id) {
      setNotice(AUTH_ENABLED
        ? `Your phone isn't streaming yet. Open the Aether app, signed in as ${user.email}, press Start, then press Connect.`
        : 'No phone is streaming yet. Press Start in the Aether app, then press Connect.');
      return;
    }
    setWatching(id);
    setRevealKey((n) => n + 1);
  }

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
          <LiveStream sessionId={watching} aspect="16x10" full onState={setStreamState}
            idleText={AUTH_ENABLED ? 'Press Connect to watch the phone’s camera.' : undefined} />
          <div className="under-stage">
            <span>
              <span className="label">Last question · {formatShortTime(question.asked_at)}</span>
              <span className="last-question" lang={question.language} dir="auto">“{question.question}”</span>
            </span>
            <span className="chip">Speaking answer</span>
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
            <DynamicButton state={buttonState} onClick={connect}
              labels={{ idle: 'Connect', busy: 'Connecting…', done: 'Connected' }} />
            <p className="hint">
              Sign in to the Aether app on the phone with this same account and press Start. Connect then shows its camera here.
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
