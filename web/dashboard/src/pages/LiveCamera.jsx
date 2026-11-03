// Member 2: full-size live view of Member 1's MediaMTX stream: finds the phone's stream by itself, or plays a pasted session ID.
import { useState } from 'react';
import LiveStream from '../components/LiveStream.jsx';
import { DynamicButton, MagneticDropZone, useScramble } from '../components/ui/index.js';
import { Icon, PageHeader, formatShortTime } from '../components/ui.jsx';
import { useLiveSessionId } from '../components/useLiveSessionId.js';
import { QUESTIONS, STREAM } from '../data/mockData.js';
import { mediaClient } from '../services/mediaClient.js';

const BUTTON_STATE = { idle: 'idle', connecting: 'busy', waiting: 'busy', live: 'done' };

export default function LiveCamera() {
  const [manualId, setManualId] = useState(() => mediaClient.savedSessionId());
  const automatic = useLiveSessionId(manualId);
  const [pickedId, setPickedId] = useState(null);
  const [stopped, setStopped] = useState(false);
  const candidate = pickedId ?? automatic;
  const sessionId = stopped ? null : candidate;

  const [streamState, setStreamState] = useState('idle');
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState({ text: '', key: 0 });
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState('');
  const scramble = useScramble(reveal.text, { runKey: reveal.key, charset: 'hex', step: 1.2, tick: 40, keepPrefix: 5 });

  // The field shows the session being watched until someone types their own.
  const shownPath = draft || (candidate ? `live/${candidate}` : '');
  const value = reveal.text && !scramble.settled ? scramble.shown : shownPath;
  const question = QUESTIONS[0];

  async function find() {
    setFinding(true);
    setError('');
    const id = await mediaClient.findLiveSessionId();
    setFinding(false);
    if (!id) {
      setError('No phone is streaming right now. Tap Start in the phone app, then try again.');
      return;
    }
    const path = `live/${id}`;
    setDraft(path);
    setReveal((r) => ({ text: path, key: r.key + 1 }));
    setPickedId(id);
    setStopped(false);
  }

  function connect() {
    // Connecting or connected: the same button disconnects.
    if (sessionId && streamState !== 'idle') {
      setStopped(true);
      return;
    }
    const id = mediaClient.parseSessionId(shownPath);
    if (!id) {
      setError('That doesn’t look like a session ID. Press Find stream, or paste live/<session ID>.');
      return;
    }
    setError('');
    setStopped(false);
    if (id !== candidate) {
      setPickedId(null);
      setManualId(id);
      mediaClient.saveSessionId(id);
    }
  }

  function useAutomatic() {
    setManualId(null);
    setPickedId(null);
    setDraft('');
    setError('');
    setStopped(false);
    mediaClient.saveSessionId(null);
  }

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
          <LiveStream sessionId={sessionId} aspect="16x10" full onState={setStreamState} />
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
              <label htmlFor="session-path" className="sr-only">Stream path or session ID</label>
              <input id="session-path" className="session-input" value={value} spellCheck={false} autoComplete="off"
                placeholder="live/<session ID>" readOnly={Boolean(reveal.text) && !scramble.settled}
                onChange={(event) => { setDraft(event.target.value); setReveal((r) => ({ text: '', key: r.key })); }} />
              <button type="button" className="btn btn-sm" onClick={find} disabled={finding}>
                <Icon name="refresh" size={15} strokeWidth="2" />{finding ? 'Finding…' : 'Find stream'}
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{reveal.text ? `Found ${reveal.text}` : ''}</span>
            {error && <p className="form-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
            <DynamicButton state={BUTTON_STATE[streamState]} onClick={connect}
              labels={{ idle: 'Connect', busy: 'Connecting…', done: 'Connected' }} />
            <dl className="facts">
              {facts.map(([term, detail]) => (
                <div key={term} className="inset"><dt className="label">{term}</dt><dd>{detail}</dd></div>
              ))}
            </dl>
            {manualId && (
              <button type="button" className="btn self-start" onClick={useAutomatic}>Use automatic</button>
            )}
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
