// Member 2: health of the streaming, multimedia and AI services, plus the project's safety and privacy rules.
import StatusPanel from '../components/StatusPanel.jsx';
import { Avatar, Icon, PageHeader } from '../components/ui.jsx';
import { SESSION_ID, STATUS } from '../data/mockData.js';

const RULES = [
  ['clock', 'Frames and question history are deleted after 24 hours.'],
  ['eye', 'No face recognition. People are only detected as “person”.'],
  ['alert', 'The assistant never says a place is safe and admits when it is not sure.'],
  ['settings', 'Provider API keys stay on the backend services, never in this dashboard.'],
];

export default function SystemStatus() {
  return (
    <>
      <PageHeader
        eyebrow="Monitoring / System status"
        title="System status"
        subtitle="Health of the three services this dashboard depends on."
        actions={<Avatar />}
      />
      <StatusPanel status={STATUS} variant="full" />
      <section className="card" aria-labelledby="rules-title">
        <div className="card-head">
          <h2 id="rules-title" className="card-title">Session and ground rules</h2>
          <code className="endpoint endpoint-inline">{SESSION_ID}</code>
        </div>
        <ul className="rules">
          {RULES.map(([icon, text]) => (
            <li key={text} className="rule">
              <span className="icon-tile icon-tile-sm tile-teal"><Icon name={icon} size={16} /></span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
