// Member 2: session ticket, health of the three services, where answers come from, ending the session and the ground rules.
import { useState } from 'react';
import { HoldToConfirm, LogoTraceLoader, Selector, Ticket } from '../components/ui/index.js';
import { Icon, PageHeader, StatusPill, formatShortTime } from '../components/ui.jsx';
import { useStatus } from '../components/useBackend.js';

const portOf = (url, fallback) => {
  try { return `:${new URL(url).port || fallback}`; } catch { return `:${fallback}`; }
};

const SERVICES = [
  {
    key: 'streaming', name: 'Stream', owner: 'Member 1 · MediaMTX', endpoint: portOf(import.meta.env.VITE_MEDIA_WHEP_BASE_URL, 8889),
    description: 'Phone camera over WebRTC, watched here over WHEP.',
  },
  {
    key: 'multimedia', name: 'Memory', owner: 'Member 3 · Multimedia API', endpoint: portOf(import.meta.env.VITE_MULTIMEDIA_API_URL, 8003),
    description: 'Keeps sharp frames, reads text, finds objects.',
  },
  {
    key: 'ai', name: 'AI', owner: 'Member 2 · AI backend', endpoint: portOf(import.meta.env.VITE_AI_API_URL, 8002),
    description: 'Answers from what was seen, in English and Arabic.',
  },
];

// Same modes as /api/v1/search.
const SOURCES = [
  { value: 'latest', label: 'Right now', description: 'Only what the camera saw in the last 10 seconds' },
  { value: 'recent', label: 'Last 2 minutes', description: 'Good for “what did I just pass?”' },
  { value: 'history', label: 'Whole session', description: 'Searches every frame kept today' },
];

const RULES = [
  ['clock', 'Frames and question history are deleted after 24 hours.'],
  ['eye', 'No face recognition. Faces are blurred before any frame is kept or sent to an AI service.'],
  ['alert', 'The assistant never says a place is safe and admits when it is not sure.'],
  ['key', 'Provider API keys stay on the backend services, never in this dashboard.'],
];

export default function SystemStatus() {
  const [source, setSource] = useState('recent');
  const [checkKey, setCheckKey] = useState(0);
  const { status, details, liveSession, checking, check: recheck } = useStatus();
  const online = SERVICES.filter((service) => status[service.key] === 'online').length;

  const check = () => {
    setCheckKey((n) => n + 1);
    recheck();
  };

  return (
    <>
      <PageHeader eyebrow="Monitoring / System status" title="System status"
        subtitle="This session, the services behind it, and the rules it follows." />

      {liveSession ? (
        <Ticket id={liveSession.session_id} facts={[
          ['Started', `${formatShortTime(liveSession.started_at)} UTC`],
          ['Video', liveSession.streaming === false ? 'Not reaching server' : 'Streaming'],
          ['Languages', 'EN · AR'],
          ['Kept for', '24 hours'],
        ]} />
      ) : (
        <section className="card section section-tight" aria-label="Session">
          <p className="sub">No live session. Press Start in the Aether app to begin one.</p>
        </section>
      )}

      <div className="grid grid-status">
        <section className="card section section-tight" aria-labelledby="svc-title">
          <div className="card-head">
            <span className="with-icon">
              <LogoTraceLoader runKey={checkKey} />
              <h2 id="svc-title" className="card-title">Services · {online} / {SERVICES.length} online</h2>
            </span>
            <button type="button" className="btn" onClick={check} disabled={checking}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <ul className="list" aria-live="polite">
            {SERVICES.map((service) => (
              <li key={service.key} className="service-full inset">
                <span>
                  <strong>{service.name}</strong>
                  <span className="service-desc">{details[service.key] ?? service.description}</span>
                  <span className="label">{service.owner} · {service.endpoint}</span>
                </span>
                <StatusPill status={status[service.key]} />
              </li>
            ))}
          </ul>
        </section>

        <div className="stack">
          <section className="card section section-tight" aria-labelledby="src-title">
            <h2 id="src-title" className="card-title">Where answers come from</h2>
            <Selector label="Answer source" labelledBy="src-title" options={SOURCES} value={source} onChange={setSource} />
          </section>

          <section className="card section section-tight" aria-labelledby="end-title">
            <h2 id="end-title" className="card-title">End this session</h2>
            <p className="sub">Stops the stream and deletes this session’s frames and history.</p>
            <HoldToConfirm label="Hold to end session" doneLabel="Session ended" finalLabel="Session ended · frames deleted"
              undoMessage={(seconds) => `Session ended. Undo in ${seconds} s`} />
          </section>
        </div>
      </div>

      <section className="card section section-tight" aria-labelledby="rules-title">
        <h2 id="rules-title" className="card-title">Ground rules</h2>
        <ul className="list">
          {RULES.map(([icon, text]) => (
            <li key={text} className="rule inset"><Icon name={icon} size={16} />{text}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
