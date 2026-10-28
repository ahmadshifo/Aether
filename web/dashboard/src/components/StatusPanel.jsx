// Member 2: shows online/connecting/offline/error states for streaming, vision memory and AI services.
import { Icon, STATUS_LABELS, StatusDot } from './ui.jsx';

const SERVICES = [
  {
    key: 'streaming', name: 'Stream', icon: 'video', owner: 'Member 1 · MediaMTX',
    description: 'Phone camera published over WebRTC, read here over WHEP.',
    endpoint: import.meta.env.VITE_MEDIA_WHEP_BASE_URL,
  },
  {
    key: 'multimedia', name: 'Memory', icon: 'database', owner: 'Member 3 · Multimedia API',
    description: 'Frame selection, OCR, object labels and semantic search.',
    endpoint: import.meta.env.VITE_MULTIMEDIA_API_URL,
  },
  {
    key: 'ai', name: 'AI', icon: 'sparkle', owner: 'Member 2 · AI backend',
    description: 'Grounded answers in English and Arabic, plus question history.',
    endpoint: import.meta.env.VITE_AI_API_URL,
  },
];

export default function StatusPanel({ status, variant = 'compact' }) {
  const online = SERVICES.filter((service) => status[service.key] === 'online').length;

  if (variant === 'compact') {
    return (
      <section className="card health-card" aria-labelledby="health-title">
        <div className="card-head">
          <h2 id="health-title" className="card-title">System health</h2>
          <span className="muted-sm">{online} / {SERVICES.length} online</span>
        </div>
        <ul className="health-inline">
          {SERVICES.map((service) => (
            <li key={service.key}>
              {service.name}
              <StatusDot status={status[service.key]} />
              <span className="sr-only">{STATUS_LABELS[status[service.key]]}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <ul className="service-grid">
      {SERVICES.map((service) => (
        <li key={service.key} className="card service-card">
          <div className="card-head">
            <span className={`icon-tile tile-${service.key}`}><Icon name={service.icon} size={20} /></span>
            <span className={`pill pill-status-${status[service.key]}`}>
              <StatusDot status={status[service.key]} />{STATUS_LABELS[status[service.key]]}
            </span>
          </div>
          <h2 className="service-name">{service.name}</h2>
          <p className="muted-sm">{service.owner}</p>
          <p className="service-desc">{service.description}</p>
          <code className="endpoint">{service.endpoint ?? 'Not configured'}</code>
        </li>
      ))}
    </ul>
  );
}
