// Member 2: "Today" card on the Overview page: questions, unsure answers, main topic, camera time, SOS alerts,
// and a small bar chart of questions per hour. Counted by the AI backend in this browser's time zone.
import { useCallback, useEffect, useState } from 'react';
import { safetyClient } from '../services/safetyClient.js';

const REFRESH_MS = 60000;
const TOPIC = { reading: 'reading signs and text', finding: 'finding things', safety: 'checking the way',
  describing: 'describing what’s in front', other: 'other questions' };

function minutes(total) {
  const hours = Math.floor(total / 60);
  return hours ? `${hours} h ${total % 60} min` : `${total} min`;
}

// One sentence a caregiver can read at a glance.
export function summarySentence(day) {
  if (!day.questions) return day.camera_minutes ? `No questions yet today. The camera was on for ${minutes(day.camera_minutes)}.` : 'No activity yet today.';
  const parts = [`${day.questions} question${day.questions === 1 ? '' : 's'} today`];
  if (day.main_topic) parts.push(`mostly ${TOPIC[day.main_topic]}`);
  let text = `${parts.join(', ')}.`;
  if (day.unsure_answers) text += ` ${day.unsure_answers} answer${day.unsure_answers === 1 ? ' was' : 's were'} unsure.`;
  if (day.camera_minutes) text += ` Camera on for ${minutes(day.camera_minutes)}.`;
  return text;
}

export default function DailySummary() {
  const [state, setState] = useState({ loading: true, error: null, day: null });

  const load = useCallback(async () => {
    try { setState({ loading: false, error: null, day: await safetyClient.summary() }); }
    catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const { day } = state;
  const peak = day ? Math.max(1, ...day.questions_per_hour) : 1;
  return (
    <section className="card section section-tight" aria-labelledby="today-title" aria-busy={state.loading}>
      <div className="card-head">
        <h2 id="today-title" className="card-title">Today</h2>
        {day?.sos_alerts > 0 && <span className="pill pill-danger">{day.sos_alerts} SOS</span>}
      </div>
      {state.error && !day && <p className="sub" role="alert">Couldn't load today's summary: {state.error}</p>}
      {state.loading && !day && <p className="sub">Loading today's summary…</p>}
      {day && (
        <>
          <p className="summary-sentence">{summarySentence(day)}</p>
          <dl className="summary-stats">
            <div className="inset"><dt className="label">Questions</dt><dd>{day.questions}</dd></div>
            <div className="inset"><dt className="label">Unsure</dt><dd>{day.unsure_answers}</dd></div>
            <div className="inset"><dt className="label">Camera on</dt><dd>{minutes(day.camera_minutes)}</dd></div>
            <div className="inset"><dt className="label">Sessions</dt><dd>{day.sessions}</dd></div>
          </dl>
          <div className="summary-chart" role="img"
            aria-label={day.questions ? `Questions per hour; busiest at ${day.busiest_hour}:00` : 'No questions per hour yet'}>
            {day.questions_per_hour.map((count, hour) => (
              <span key={hour} className="summary-bar" title={`${hour}:00 · ${count} question${count === 1 ? '' : 's'}`}
                style={{ height: `${Math.max(4, (count / peak) * 100)}%`, opacity: count ? 1 : 0.25 }} />
            ))}
          </div>
          <div className="summary-axis" aria-hidden="true"><span>0:00</span><span>12:00</span><span>23:00</span></div>
        </>
      )}
    </section>
  );
}
