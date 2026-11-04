// Member 2: overview: live stream with the text it just read, latest answer slip, system health and recently remembered frames.
import { useContext, useState } from 'react';
import { Link } from 'react-router';
import { AUTH_ENABLED } from '../auth.js';
import LiveStream from '../components/LiveStream.jsx';
import { Barcode, LogoTraceLoader, ReceiptPrinter, ScrambleText, Stamp } from '../components/ui/index.js';
import {
  PageHeader, SceneArt, STATUS_LABELS, StatusPill, UserContext, formatTime, frameTitle, signText,
} from '../components/ui.jsx';
import { useLiveSessionId } from '../components/useLiveSessionId.js';
import { FRAMES, QUESTIONS, SESSION_ID, STATUS, sceneFor } from '../data/mockData.js';

const RECENT = [
  ['a1e5c9f3-7d2b-4c8e-9a6f-3b0d5e1c7a94', -1.5],
  ['7b3f9d1e-6c2a-4e5b-8f0d-1a9c3e7b5d28', 1],
  ['b8b51e4a-32f2-4542-bbb1-cc9e6de18384', -0.5],
];

const SERVICES = [
  { key: 'streaming', name: 'Stream', owner: 'Member 1 · MediaMTX' },
  { key: 'multimedia', name: 'Memory', owner: 'Member 3 · Multimedia API' },
  { key: 'ai', name: 'AI', owner: 'Member 2 · AI backend' },
];

function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function AnswerSlip({ question, evidence }) {
  return (
    <div className="receipt">
      <div className="receipt-row"><span>Aether · Answer slip</span><span>{formatTime(question.asked_at)}</span></div>
      <span className="receipt-muted">Session {SESSION_ID.slice(0, 8)}</span>
      <span className="receipt-rule" />
      <span lang={question.language} dir="auto">Q&nbsp; {question.question}</span>
      <span lang={question.language} dir="auto">A&nbsp; {question.answer}</span>
      <span className="receipt-rule" />
      <div className="receipt-row"><span>Language</span><span>{question.language.toUpperCase()}</span></div>
      <div className="receipt-row"><span>Confidence</span><span>{question.uncertain ? 'Not sure' : 'Sure'}</span></div>
      <div className="receipt-row"><span>Evidence</span><span>{evidence} frame{evidence === 1 ? '' : 's'}</span></div>
      <Barcode />
    </div>
  );
}

export default function Overview() {
  const user = useContext(UserContext);
  // Plays this account's phone stream here as soon as the phone presses Start.
  const liveSessionId = useLiveSessionId() ?? null;
  const latest = QUESTIONS[0];
  const evidence = FRAMES.filter((frame) => latest.evidence_frame_ids.includes(frame.frame_id));
  const readText = evidence.find((frame) => frame.ocr_text)?.ocr_text ?? '';
  const recent = RECENT.map(([id, tilt]) => ({ frame: FRAMES.find((frame) => frame.frame_id === id), tilt }));
  const [readKey, setReadKey] = useState(0);
  const [checkKey, setCheckKey] = useState(0);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setCheckKey((n) => n + 1);
    setChecking(true);
    window.setTimeout(() => setChecking(false), 1100);
  };

  return (
    <>
      <PageHeader
        eyebrow="Monitoring / Overview"
        title={`${greeting()}, ${user?.user_id ? user.name.split(' ')[0] : 'team'}`}
        subtitle="One live session. Everything the phone sees and hears shows up here."
        actions={<span className="pill pill-ok"><span className="dot" />Session active</span>}
      />

      <section className="stat-row" aria-label="Summary">
        <div className="card stat">
          <span className="label">Live connection</span>
          <p className="stat-value">{STATUS.streaming === 'online' ? 'Connected' : STATUS_LABELS[STATUS.streaming]}</p>
        </div>
        <div className="card stat"><span className="label">Saved frames</span><p className="stat-value">{FRAMES.length}</p></div>
        <div className="card stat">
          <span className="label">Assistant</span>
          <p className="stat-value">{STATUS.ai === 'online' ? 'Ready' : STATUS_LABELS[STATUS.ai]}</p>
        </div>
      </section>

      <div className="grid grid-overview">
        <section className="card section" aria-labelledby="live-title">
          <div className="card-head">
            <h2 id="live-title" className="card-title">Live stream</h2>
            <Link to="/live" className="btn">Open full view</Link>
          </div>
          <LiveStream sessionId={liveSessionId} aspect="16x9"
            idleText={AUTH_ENABLED ? 'Your phone isn’t streaming. Press Start in the Aether app.' : undefined} />
          <div className="ocr-panel inset">
            <span>
              <span className="label">Text read just now</span>
              <ScrambleText className="ocr-text" text={readText} runKey={readKey} />
            </span>
            <button type="button" className="btn" onClick={() => setReadKey((n) => n + 1)}>Read again</button>
          </div>
        </section>

        <div className="stack">
          <section className="card section section-tight" aria-labelledby="answer-title">
            <div className="card-head">
              <h2 id="answer-title" className="card-title">Latest answer</h2>
              <span className="label">Just now · {latest.language.toUpperCase()}</span>
            </div>
            <p className="answer-q" lang={latest.language} dir="auto">“{latest.question}”</p>
            <p className="answer-a" lang={latest.language} dir="auto">{latest.answer}</p>
            <ReceiptPrinter><AnswerSlip question={latest} evidence={evidence.length} /></ReceiptPrinter>
          </section>

          <section className="card section section-tight" aria-labelledby="health-title">
            <div className="card-head">
              <span className="with-icon">
                <LogoTraceLoader runKey={checkKey} />
                <h2 id="health-title" className="card-title">System health</h2>
              </span>
              <button type="button" className="btn" onClick={check} disabled={checking}>
                {checking ? 'Checking…' : 'Check again'}
              </button>
            </div>
            <ul className="list" aria-live="polite">
              {SERVICES.map((service) => (
                <li key={service.key} className="service-row inset">
                  <span><strong className="service-name">{service.name}</strong><span className="service-owner">{service.owner}</span></span>
                  <StatusPill status={STATUS[service.key]} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="card section" aria-labelledby="recent-title">
        <div className="card-head">
          <h2 id="recent-title" className="card-title">Recently remembered</h2>
          <Link to="/memory" className="btn">View all {FRAMES.length}</Link>
        </div>
        <ul className="stamps">
          {recent.map(({ frame, tilt }) => (
            <li key={frame.frame_id}>
              <Stamp to={`/memory/${frame.frame_id}`} tilt={tilt}
                label={`${frameTitle(frame)} at ${formatTime(frame.captured_at)}`}
                caption={<><span>{frameTitle(frame)}</span><span>{formatTime(frame.captured_at)}</span></>}>
                <SceneArt scene={sceneFor(frame)} sign={signText(frame.ocr_text)} />
              </Stamp>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
