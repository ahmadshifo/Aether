// Member 2: overview: live stream with the text it just read, latest answer slip, system health and recently remembered frames.
import { useContext, useState } from 'react';
import { Link } from 'react-router';
import LiveStream from '../components/LiveStream.jsx';
import { Barcode, LogoTraceLoader, ReceiptPrinter, ScrambleText, Stamp } from '../components/ui/index.js';
import {
  Icon, PageHeader, STATUS_LABELS, StatusPill, UserContext, formatTime,
} from '../components/ui.jsx';
import { useWatchedSession } from '../components/useWatchedSession.js';
import { useCameraPaused } from '../components/useLiveSessionId.js';
import DailySummary from '../components/DailySummary.jsx';
import PhoneBattery from '../components/PhoneBattery.jsx';
import TalkToUser from '../components/TalkToUser.jsx';
import { useQuestions, useRecentFrames, useStatus } from '../components/useBackend.js';
import { memoryClient } from '../services/memoryClient.js';

const TILTS = [-1.5, 1, -0.5];

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
      <span className="receipt-muted">Session {question.session_id.slice(0, 8)}</span>
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
  // The phone's stream plays here only after Connect (shared with the Live camera page); Disconnect stops it.
  const { watching, looking, notice, liveId, connect, disconnect } = useWatchedSession(user?.email);
  const paused = useCameraPaused(watching);
  const { status, checking, check: recheck } = useStatus();
  const history = useQuestions();
  const latest = history.questions[0];
  const saved = useRecentFrames();
  // The text read in the newest saved frame that has some (empty while text reading is off).
  const readText = saved.frames.find((frame) => frame.ocr_text)?.ocr_text ?? '';
  const recent = saved.frames.slice(0, TILTS.length);
  const [readKey, setReadKey] = useState(0);
  const [checkKey, setCheckKey] = useState(0);
  const streaming = Boolean(liveId);
  const questionCount = String(history.questions.length);

  const check = () => {
    setCheckKey((n) => n + 1);
    recheck();
  };

  return (
    <>
      <PageHeader
        eyebrow="Monitoring / Overview"
        title={`${greeting()}, ${user?.user_id ? user.name.split(' ')[0] : 'team'}`}
        subtitle="One live session. Everything the phone sees and hears shows up here."
        actions={streaming
          ? <span className="pill pill-ok"><span className="dot" />Phone streaming</span>
          : <span className="pill pill-warn"><span className="dot" />Phone not streaming</span>}
      />

      <section className="stat-row" aria-label="Summary">
        <div className="card stat">
          <span className="label">Live connection</span>
          <p className="stat-value">{watching ? 'Watching' : streaming ? 'Phone streaming' : status.streaming === 'online' ? 'Waiting for phone' : STATUS_LABELS[status.streaming]}</p>
        </div>
        <div className="card stat"><span className="label">Questions · 24 h</span><p className="stat-value">{history.loading ? '…' : questionCount}</p></div>
        <div className="card stat">
          <span className="label">Assistant</span>
          <p className="stat-value">{status.ai === 'online' ? 'Ready' : status.ai === 'offline' ? 'Not ready' : STATUS_LABELS[status.ai]}</p>
        </div>
      </section>

      <div className="grid grid-overview">
        <section className="card section" aria-labelledby="live-title">
          <div className="card-head">
            <h2 id="live-title" className="card-title">Live stream</h2>
            <div className="btn-row">
              <PhoneBattery />
              {watching
                ? <button type="button" className="btn" onClick={disconnect}>Disconnect</button>
                : <button type="button" className="btn" onClick={connect} disabled={looking}>{looking ? 'Connecting…' : 'Connect'}</button>}
              <Link to="/live" className="btn">Open full view</Link>
            </div>
          </div>
          <LiveStream sessionId={watching} aspect="16x9" paused={paused}
            idleText={streaming ? 'Your phone is streaming. Press Connect to watch it.' : 'Your phone isn’t streaming. Press Start in the Aether app.'} />
          {notice && <p className="note" role="status"><Icon name="alert" size={16} />{notice}</p>}
          <div className="ocr-panel inset">
            <span>
              <span className="label">Text read just now</span>
              <ScrambleText className="ocr-text" text={readText || 'No text read yet.'} runKey={readKey} />
            </span>
            <button type="button" className="btn" onClick={() => setReadKey((n) => n + 1)}>Read again</button>
          </div>
        </section>

        <div className="stack">
          <DailySummary />
          <TalkToUser />

          <section className="card section section-tight" aria-labelledby="answer-title">
            <div className="card-head">
              <h2 id="answer-title" className="card-title">
                Latest answer
              </h2>
              {latest && <span className="label">{formatTime(latest.asked_at)} · {latest.language.toUpperCase()}</span>}
            </div>
            {latest ? (
              <>
                <p className="answer-q" lang={latest.language} dir="auto">“{latest.question}”</p>
                <p className="answer-a" lang={latest.language} dir="auto">{latest.answer}</p>
                <ReceiptPrinter><AnswerSlip question={latest} evidence={latest.evidence_frame_ids.length} /></ReceiptPrinter>
              </>
            ) : (
              <p className="empty">{history.loading ? 'Loading…' : history.error ? `Couldn't load answers: ${history.error}` : 'No answers yet.'}</p>
            )}
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
                  <StatusPill status={status[service.key]} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="card section" aria-labelledby="recent-title">
        <div className="card-head">
          <h2 id="recent-title" className="card-title">Recently remembered</h2>
          <Link to="/memory" className="btn">View all {saved.frames.length}</Link>
        </div>
        {recent.length ? (
          <ul className="stamps">
            {recent.map((frame, index) => (
              <li key={frame.frame_id}>
                <Stamp to={`/memory/${frame.frame_id}`} tilt={TILTS[index]}
                  label={`${frame.caption || 'Saved frame'} at ${formatTime(frame.captured_at)}`}
                  caption={<><span>{frame.caption || 'Saved frame'}</span><span>{formatTime(frame.captured_at)}</span></>}>
                  <img src={memoryClient.imageUrl(frame.frame_id)} alt="" loading="lazy" draggable={false}
                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                </Stamp>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{saved.loading ? 'Loading…' : saved.error ? `Couldn't load saved frames: ${saved.error}`
            : 'No saved frames yet. They appear while the phone streams and when the assistant answers.'}</p>
        )}
      </section>
    </>
  );
}
