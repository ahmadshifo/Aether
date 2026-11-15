// Member 2: "Message the user". The caregiver types a short message; during a session the phone reads it aloud
// (when it isn't answering a question) and marks it read, so the list shows "Read aloud at ...".
import { useCallback, useEffect, useState } from 'react';
import { safetyClient } from '../services/safetyClient.js';
import { DynamicButton } from './ui/index.js';
import { Icon, formatTime } from './ui.jsx';

const CHECK_EVERY_MS = 5000;
const MAX_LENGTH = 300;

export default function CaregiverNotes() {
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | done
  const [error, setError] = useState('');

  const load = useCallback(() => safetyClient.notes().then(setNotes).catch(() => {}), []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    setState('busy');
    setError('');
    try {
      await safetyClient.sendNote(text);
      setText('');
      setState('done');
      await load();
    } catch (err) {
      setError(err.message);
      setState('idle');
    }
  }

  return (
    <section className="card section section-tight" aria-labelledby="notes-title">
      <h2 id="notes-title" className="card-title">Message the user</h2>
      <p className="sub">The phone reads your message aloud during the session, when it isn’t answering a question.</p>
      <form className="notes-form" onSubmit={submit}>
        <label className="field">Message
          <textarea className="input" rows={2} maxLength={MAX_LENGTH} value={text} placeholder="Dinner is ready, come to the kitchen."
            onChange={(event) => { setText(event.target.value); if (state === 'done') setState('idle'); }} />
          <span className="hint">{text.length} / {MAX_LENGTH}</span>
        </label>
        {error && <p className="form-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
        <DynamicButton type="submit" state={state} disabled={!text.trim() || state === 'busy'}
          labels={{ idle: 'Send to phone', busy: 'Sending…', done: 'Sent' }} />
      </form>
      {notes.length > 0 && (
        <ul className="notes-list" aria-label="Sent messages">
          {notes.slice(0, 5).map((note) => (
            <li key={note.note_id} className="inset">
              <span>{note.text}</span>
              <span className="label">
                {note.read_at ? `Read aloud at ${formatTime(note.read_at)}` : `Sent at ${formatTime(note.created_at)} · waiting for the phone`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
