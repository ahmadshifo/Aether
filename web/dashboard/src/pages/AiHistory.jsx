// Member 2: question-and-answer history with filters for uncertain answers and language.
import { useState } from 'react';
import QuestionHistory from '../components/QuestionHistory.jsx';
import { Avatar, PageHeader } from '../components/ui.jsx';
import { FRAMES, QUESTIONS } from '../data/mockData.js';

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'unsure', label: 'Not sure', test: (q) => q.uncertain },
  { id: 'en', label: 'English', test: (q) => q.language === 'en' },
  { id: 'ar', label: 'Arabic', test: (q) => q.language === 'ar' },
];

export default function AiHistory() {
  const [filter, setFilter] = useState('all');
  const { test } = FILTERS.find((option) => option.id === filter);
  const questions = QUESTIONS.filter(test);

  return (
    <>
      <PageHeader
        eyebrow="Assistant / AI history"
        title="AI history"
        subtitle="Every question asked in this session, and what the assistant answered."
        actions={<Avatar />}
      />
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter questions">
          {FILTERS.map((option) => (
            <button key={option.id} type="button" aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <span className="muted-sm" aria-live="polite">{questions.length} of {QUESTIONS.length} questions</span>
      </div>
      <QuestionHistory questions={questions} frames={FRAMES} />
    </>
  );
}
