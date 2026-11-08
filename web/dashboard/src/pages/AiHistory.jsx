// Member 2: every question and answer, filterable by "not sure" and language, with the spoken answer and its evidence frames.
// Loads GET /api/v1/questions from the AI backend. While the assistant has not answered anything yet,
// the backend returns sample records marked demo, and this page says so.
import { useCallback, useEffect, useState } from 'react';
import { CassettePlayer, ScrollFadeList, Segmented, Stamp } from '../components/ui/index.js';
import { PageHeader, SceneArt, formatTime, frameTitle, signText } from '../components/ui.jsx';
import { FRAMES, sceneFor } from '../data/mockData.js';
import { assistantClient } from '../services/assistantClient.js';

const FILTERS = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'unsure', label: 'Not sure', test: (q) => q.uncertain },
  { value: 'en', label: 'English', test: (q) => q.language === 'en' },
  { value: 'ar', label: 'Arabic', test: (q) => q.language === 'ar' },
];
// Demo answers point at the sample scenes; real answers point at saved frames in the multimedia service.
const sampleFrame = Object.fromEntries(FRAMES.map((frame) => [frame.frame_id, frame]));
const dir = (language) => (language === 'ar' ? 'rtl' : 'ltr');

function Evidence({ id, index }) {
  const tilt = index % 2 ? 1.5 : -1.5;
  const frame = sampleFrame[id];
  if (frame) {
    return (
      <Stamp small to={`/memory/${frame.frame_id}`} tilt={tilt}
        label={`Open evidence frame: ${frameTitle(frame)} at ${formatTime(frame.captured_at)}`}
        caption={`${formatTime(frame.captured_at)} · ${frameTitle(frame)}`}>
        <SceneArt scene={sceneFor(frame)} sign={signText(frame.ocr_text)} blur={/blur/i.test(frame.caption)} />
      </Stamp>
    );
  }
  const src = `/api/v1/frames/${id}/image`;
  return (
    <a className="stamp stamp-sm" href={src} target="_blank" rel="noreferrer" style={{ transform: `rotate(${tilt}deg)` }}
      aria-label="Open evidence frame image">
      <span className="stamp-art"><img src={src} alt="Evidence frame (faces blurred)" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>
      <span className="stamp-caption">Evidence frame</span>
    </a>
  );
}

export default function AiHistory() {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [state, setState] = useState({ loading: true, error: null, questions: [], demo: false });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await assistantClient.questions();
      setState({ loading: false, error: null, questions: data.questions, demo: data.demo });
    } catch (error) {
      setState({ loading: false, error: error.message, questions: [], demo: false });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { test } = FILTERS.find((option) => option.value === filter);
  const all = state.questions;
  const list = all.filter(test);
  const selected = list.find((q) => q.question_id === selectedId) ?? list[0];

  return (
    <>
      <PageHeader
        eyebrow="Assistant / AI history"
        title="AI history"
        subtitle={state.demo
          ? 'Sample questions shown until the assistant answers real ones.'
          : 'Every question asked, and the answer the user heard.'}
        actions={<Segmented label="Filter questions" options={FILTERS} value={filter} onChange={setFilter} />}
      />

      <div className="grid grid-history">
        <section className="card section section-tight" aria-labelledby="list-title" aria-busy={state.loading}>
          <div className="card-head">
            <h2 id="list-title" className="card-title">
              Questions {state.demo && <span className="chip-warn">DEMO</span>}
            </h2>
            <span className="label" aria-live="polite">{state.loading ? 'Loading…' : `${list.length} of ${all.length}`}</span>
          </div>
          {state.error ? (
            <div className="empty" role="alert">
              <p>Couldn't load the history: {state.error}</p>
              <button type="button" className="btn" onClick={load}>Try again</button>
            </div>
          ) : list.length ? (
            <ScrollFadeList label="Questions">
              {list.map((q) => (
                <li key={q.question_id}>
                  <button type="button" className="q-item" aria-pressed={q === selected} onClick={() => setSelectedId(q.question_id)}>
                    <span className="q-meta">
                      {formatTime(q.asked_at)} · {q.language.toUpperCase()}
                      {q.uncertain && <span className="chip-warn">NOT SURE</span>}
                    </span>
                    <span className="q-text" lang={q.language} dir={dir(q.language)}>{q.question}</span>
                  </button>
                </li>
              ))}
            </ScrollFadeList>
          ) : (
            !state.loading && <p className="empty">{all.length ? 'No questions match this filter.' : 'No questions yet.'}</p>
          )}
        </section>

        {selected && (
          <section className="card detail" aria-labelledby="detail-title">
            <span className="label with-icon">
              {formatTime(selected.asked_at)} · {selected.language.toUpperCase()}
              {selected.uncertain && <span className="chip-warn">NOT SURE</span>}
            </span>
            <div className="detail-qa" lang={selected.language} dir={dir(selected.language)}>
              <h2 id="detail-title" className="detail-q">“{selected.question}”</h2>
              <p className={`detail-a${selected.uncertain ? ' is-unsure' : ''}`}>{selected.answer}</p>
            </div>

            <CassettePlayer text={selected.answer} language={selected.language} stamp={formatTime(selected.asked_at)} />

            <div className="stack-sm">
              <span className="label">Evidence frames</span>
              <ul className="evidence">
                {selected.evidence_frame_ids.map((id, i) => <li key={id}><Evidence id={id} index={i} /></li>)}
              </ul>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
