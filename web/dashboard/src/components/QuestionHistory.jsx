// Member 2: presents questions, grounded AI responses and evidence frame IDs from the assistant history API.
import { sceneFor } from '../data/mockData.js';
import { Icon, SceneArt, formatTime, frameLabel, signNumber } from './ui.jsx';

export default function QuestionHistory({ questions, frames }) {
  const frameById = Object.fromEntries(frames.map((frame) => [frame.frame_id, frame]));

  if (questions.length === 0) {
    return <p className="empty-state">No questions match this filter.</p>;
  }

  return (
    <ul className="qa-list">
      {questions.map((q) => {
        const evidence = q.evidence_frame_ids.map((id) => frameById[id]).filter(Boolean);
        return (
          <li key={q.question_id} className="card qa-item">
            <div className="qa-meta">
              <time dateTime={q.asked_at}>{formatTime(q.asked_at)} UTC</time>
              <span className="pill pill-quiet">{q.language.toUpperCase()}</span>
              {q.uncertain
                ? <span className="pill pill-warn"><Icon name="alert" size={13} />Not sure</span>
                : <span className="pill pill-ok"><Icon name="check" size={13} />Answered</span>}
            </div>

            <p className="label">Question</p>
            <p className="qa-question" lang={q.language} dir="auto">“{q.question}”</p>
            <p className="label">Answer</p>
            <p className="qa-answer" lang={q.language} dir="auto">{q.answer}</p>

            <div className="qa-evidence">
              <span className="muted-sm with-icon">
                <Icon name="image" size={14} />
                Based on {evidence.length} stored frame{evidence.length === 1 ? '' : 's'}
              </span>
              <div className="evidence-thumbs">
                {evidence.map((frame) => (
                  <a key={frame.frame_id} href={`#/memory/${frame.frame_id}`} className="evidence-thumb"
                    aria-label={`Open evidence frame: ${frameLabel(frame)}`}>
                    <SceneArt scene={sceneFor(frame)} sign={signNumber(frame.ocr_text)} />
                  </a>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
