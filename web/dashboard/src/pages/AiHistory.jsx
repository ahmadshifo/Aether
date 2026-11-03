// Member 2: every question and answer, filterable by "not sure" and language, with the spoken answer and its evidence frames.
import { useState } from 'react';
import { CassettePlayer, ScrollFadeList, Segmented, Stamp } from '../components/ui/index.js';
import { PageHeader, SceneArt, formatTime, frameTitle, signText } from '../components/ui.jsx';
import { FRAMES, QUESTIONS, sceneFor } from '../data/mockData.js';

const FILTERS = [
  { value: 'all', label: 'All', test: () => true },
  { value: 'unsure', label: 'Not sure', test: (q) => q.uncertain },
  { value: 'en', label: 'English', test: (q) => q.language === 'en' },
  { value: 'ar', label: 'Arabic', test: (q) => q.language === 'ar' },
];
const frameById = Object.fromEntries(FRAMES.map((frame) => [frame.frame_id, frame]));
const dir = (language) => (language === 'ar' ? 'rtl' : 'ltr');

export default function AiHistory() {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(QUESTIONS[0].question_id);
  const { test } = FILTERS.find((option) => option.value === filter);
  const list = QUESTIONS.filter(test);
  const selected = list.find((q) => q.question_id === selectedId) ?? list[0];
  const evidence = selected ? selected.evidence_frame_ids.map((id) => frameById[id]).filter(Boolean) : [];

  return (
    <>
      <PageHeader
        eyebrow="Assistant / AI history"
        title="AI history"
        subtitle="Every question asked, and the answer the user heard."
        actions={<Segmented label="Filter questions" options={FILTERS} value={filter} onChange={setFilter} />}
      />

      <div className="grid grid-history">
        <section className="card section section-tight" aria-labelledby="list-title">
          <div className="card-head">
            <h2 id="list-title" className="card-title">Questions</h2>
            <span className="label" aria-live="polite">{list.length} of {QUESTIONS.length}</span>
          </div>
          {list.length ? (
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
            <p className="empty">No questions match this filter.</p>
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
                {evidence.map((frame, i) => (
                  <li key={frame.frame_id}>
                    <Stamp small href={`#/memory/${frame.frame_id}`} tilt={i % 2 ? 1.5 : -1.5}
                      label={`Open evidence frame: ${frameTitle(frame)} at ${formatTime(frame.captured_at)}`}
                      caption={`${formatTime(frame.captured_at)} · ${frameTitle(frame)}`}>
                      <SceneArt scene={sceneFor(frame)} sign={signText(frame.ocr_text)} blur={/blur/i.test(frame.caption)} />
                    </Stamp>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
