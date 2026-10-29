// Member 2: full-size live view of Member 1's MediaMTX stream; finds the phone's stream by itself, or plays a pasted session ID.
import { useState } from 'react';
import LiveStream from '../components/LiveStream.jsx';
import { Avatar, Icon, PageHeader } from '../components/ui.jsx';
import { useLiveSessionId } from '../components/useLiveSessionId.js';
import { STREAM } from '../data/mockData.js';
import { mediaClient } from '../services/mediaClient.js';

export default function LiveCamera() {
  const [manualId, setManualId] = useState(() => mediaClient.savedSessionId());
  const [draft, setDraft] = useState(manualId ?? '');
  const [error, setError] = useState('');
  const sessionId = useLiveSessionId(manualId);

  const connect = (event) => {
    event.preventDefault();
    const id = mediaClient.parseSessionId(draft);
    if (!id) {
      setError('That doesn’t look like a session ID. It looks like 550e8400-e29b-41d4-a716-446655440000.');
      return;
    }
    setError('');
    setDraft(id);
    setManualId(id);
    mediaClient.saveSessionId(id);
  };

  const useAutomatic = () => {
    setManualId(null);
    setDraft('');
    setError('');
    mediaClient.saveSessionId(null);
  };

  const facts = [
    ['Mode', manualId ? 'Pasted session ID' : 'Automatic'],
    ['Protocol', STREAM.protocol],
    ['Stream path', sessionId ? mediaClient.streamPath(sessionId) : 'Waiting for the phone'],
    ['Target resolution', STREAM.resolution],
    ['Frame rate', `${STREAM.fps} fps`],
    ['Codec', STREAM.codec],
  ];

  return (
    <>
      <PageHeader
        eyebrow="Monitoring / Live camera"
        title="Live camera"
        subtitle="What the phone camera is seeing right now."
        actions={<Avatar />}
      />
      <div className="live-layout">
        <LiveStream stream={STREAM} sessionId={sessionId} large detection={{ label: 'ROOM 205', value: '205' }} />
        <section className="card" aria-labelledby="stream-title">
          <h2 id="stream-title" className="card-title">Stream details</h2>

          <form className="session-form" onSubmit={connect}>
            <label className="field">
              Session ID (optional)
              <input value={draft} onChange={(event) => setDraft(event.target.value)}
                placeholder="Found automatically" spellCheck={false} autoComplete="off"
                aria-describedby="session-hint" />
              <span id="session-hint" className="field-hint">
                The phone’s stream is found by itself. To watch a specific one, paste its ID or the MediaMTX live/&lt;session ID&gt; line.
              </span>
            </label>
            {error && <p className="auth-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
            <div className="session-actions">
              <button type="submit" className="btn btn-primary">Connect</button>
              {manualId && <button type="button" className="btn" onClick={useAutomatic}>Use automatic</button>}
            </div>
          </form>

          <dl className="facts">
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt className="muted-sm">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!sessionId && (
            <p className="note">
              <Icon name="alert" size={16} />
              Waiting for the phone. Tap Start in the phone app and the live video appears here; a mock feed shows until then.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
