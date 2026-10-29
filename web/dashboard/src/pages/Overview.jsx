// Member 2: overview page with connection/memory/AI summary, live feed, latest answer, health and recent frames.
import FrameTimeline from '../components/FrameTimeline.jsx';
import LiveStream from '../components/LiveStream.jsx';
import StatusPanel from '../components/StatusPanel.jsx';
import { useContext } from 'react';
import { Avatar, Icon, PageHeader, STATUS_LABELS, UserContext } from '../components/ui.jsx';
import { useLiveSessionId } from '../components/useLiveSessionId.js';
import { FRAMES, QUESTIONS, STATUS, STREAM } from '../data/mockData.js';
import { mediaClient } from '../services/mediaClient.js';

const RECENT_FRAME_IDS = [
  'a1e5c9f3-7d2b-4c8e-9a6f-3b0d5e1c7a94',
  '7b3f9d1e-6c2a-4e5b-8f0d-1a9c3e7b5d28',
  'b8b51e4a-32f2-4542-bbb1-cc9e6de18384',
];

function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatCard({ label, value, icon, tone }) {
  return (
    <div className="card stat-card">
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
      </div>
      <span className={`icon-tile tile-${tone}`}><Icon name={icon} size={20} /></span>
    </div>
  );
}

// Highlights the OCR text the answer quotes, so the dashboard shows what the evidence said.
function HighlightedAnswer({ answer, ocr }) {
  const at = ocr ? answer.indexOf(ocr) : -1;
  if (at === -1) return answer;
  return (
    <>
      {answer.slice(0, at)}<mark className="ocr-hit">{ocr}</mark>{answer.slice(at + ocr.length)}
    </>
  );
}

function AssistantCard({ question }) {
  const evidence = FRAMES.filter((frame) => question.evidence_frame_ids.includes(frame.frame_id));
  return (
    <section className="card assistant-card" aria-labelledby="assistant-title">
      <div className="card-head">
        <h2 id="assistant-title" className="card-title with-icon ai-title">
          <Icon name="sparkle" size={18} />AI assistant
        </h2>
        <span className="muted-sm">Just now</span>
      </div>
      <p className="label">Latest question</p>
      <p className="qa-question" lang={question.language} dir="auto">“{question.question}”</p>
      <p className="label">Answer</p>
      <p className="qa-answer" lang={question.language} dir="auto">
        <HighlightedAnswer answer={question.answer} ocr={evidence[0]?.ocr_text} />
      </p>
      <p className="muted-sm with-icon assistant-foot">
        <Icon name="image" size={14} />
        Based on {evidence.length} stored frame{evidence.length === 1 ? '' : 's'}
      </p>
    </section>
  );
}

export default function Overview() {
  const user = useContext(UserContext);
  // Plays the phone's live stream here too: a pasted ID from the Live Camera page, or the one found automatically.
  const liveSessionId = useLiveSessionId(mediaClient.savedSessionId());
  const recent = RECENT_FRAME_IDS.map((id) => FRAMES.find((frame) => frame.frame_id === id));
  const connection = STATUS.streaming === 'online' ? 'Connected' : STATUS_LABELS[STATUS.streaming];
  const assistant = STATUS.ai === 'online' ? 'Ready' : STATUS_LABELS[STATUS.ai];

  return (
    <>
      <PageHeader
        eyebrow="Monitoring / Overview"
        title={`${greeting()}, ${user?.user_id ? user.name.split(' ')[0] : 'team'}`}
        sparkle
        subtitle="One live session. All systems ready to assist."
        actions={(
          <>
            <span className="pill pill-session"><span className="dot dot-online" aria-hidden="true" />Session active</span>
            <button type="button" className="icon-btn" aria-label="Notifications"><Icon name="bell" /></button>
            <Avatar />
          </>
        )}
      />

      <div className="stat-row">
        <StatCard label="Live connection" value={connection} icon="wifi" tone="green" />
        <StatCard label="Saved frames" value={FRAMES.length} icon="image" tone="teal" />
        <StatCard label="AI assistant" value={assistant} icon="sparkle" tone="purple" />
      </div>

      <div className="overview-grid">
        <LiveStream stream={STREAM} sessionId={liveSessionId} detection={{ label: 'ROOM 205', value: '205' }} />
        <div className="side-stack">
          <AssistantCard question={QUESTIONS[0]} />
          <StatusPanel status={STATUS} />
        </div>
        <FrameTimeline frames={recent} />
      </div>
    </>
  );
}
