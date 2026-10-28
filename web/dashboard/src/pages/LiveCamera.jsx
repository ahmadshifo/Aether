// Member 2: full-size live view of Member 1's MediaMTX stream with the agreed stream settings.
import LiveStream from '../components/LiveStream.jsx';
import { Avatar, Icon, PageHeader } from '../components/ui.jsx';
import { SESSION_ID, STREAM } from '../data/mockData.js';

const FACTS = [
  ['Protocol', STREAM.protocol],
  ['Stream path', STREAM.path],
  ['Target resolution', STREAM.resolution],
  ['Frame rate', `${STREAM.fps} fps`],
  ['Codec', STREAM.codec],
  ['Session ID', SESSION_ID],
];

export default function LiveCamera() {
  return (
    <>
      <PageHeader
        eyebrow="Monitoring / Live camera"
        title="Live camera"
        subtitle="What the phone camera is seeing right now."
        actions={<Avatar />}
      />
      <div className="live-layout">
        <LiveStream stream={STREAM} large detection={{ label: 'ROOM 205', value: '205' }} />
        <section className="card" aria-labelledby="stream-title">
          <h2 id="stream-title" className="card-title">Stream details</h2>
          <dl className="facts">
            {FACTS.map(([term, value]) => (
              <div key={term}>
                <dt className="muted-sm">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="note">
            <Icon name="alert" size={16} />
            Mock feed. The real WHEP player connects once Member 1’s MediaMTX server is running.
          </p>
        </section>
      </div>
    </>
  );
}
