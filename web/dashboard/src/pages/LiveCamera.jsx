// Member 2: full-size live view of Member 1's MediaMTX stream; the phone's session ID is pasted here until MediaMTX can list live streams.
import { useState } from 'react';
import LiveStream from '../components/LiveStream.jsx';
import { Avatar, Icon, PageHeader } from '../components/ui.jsx';
import { STREAM } from '../data/mockData.js';
import { mediaClient } from '../services/mediaClient.js';

export default function LiveCamera() {
  const [sessionId, setSessionId] = useState(() => mediaClient.savedSessionId());
  const [draft, setDraft] = useState(sessionId ?? '');
  const [error, setError] = useState('');

  const connect = (event) => {
    event.preventDefault();
    const id = mediaClient.parseSessionId(draft);
    if (!id) {
      setError('That doesn’t look like a session ID. It looks like 550e8400-e29b-41d4-a716-446655440000.');
      return;
    }
    setError('');
    setDraft(id);
    setSessionId(id);
    mediaClient.saveSessionId(id);
  };

  const disconnect = () => {
    setSessionId(null);
    setDraft('');
    mediaClient.saveSessionId(null);
  };

  const facts = [
    ['Protocol', STREAM.protocol],
    ['Stream path', sessionId ? mediaClient.streamPath(sessionId) : 'Not connected'],
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
              Session ID
              <input value={draft} onChange={(event) => setDraft(event.target.value)}
                placeholder="Paste the phone's session ID" spellCheck={false} autoComplete="off"
                aria-describedby="session-hint" />
              <span id="session-hint" className="field-hint">
                When the phone starts streaming, the MediaMTX window prints live/&lt;session ID&gt;. Paste that line or just the ID.
              </span>
            </label>
            {error && <p className="auth-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
            <div className="session-actions">
              <button type="submit" className="btn btn-primary">Connect</button>
              {sessionId && <button type="button" className="btn" onClick={disconnect}>Disconnect</button>}
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
              Showing a mock feed. Paste the session ID above to watch the phone’s camera.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
