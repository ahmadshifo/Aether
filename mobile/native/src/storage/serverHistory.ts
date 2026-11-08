// Pulls the account's questions and answers from the AI backend (GET /api/v1/questions) into the phone's
// History list. The backend returns sample records (demo: true) until the assistant answers real questions.
// Uses the same login cookie as /api/v1/streams. Failures leave the local list as it is.
import { boundedFetch } from '../platform/config';
import type { Entry } from '../shared/types';

type ServerQuestion = {
  question_id: string; session_id: string; asked_at: string; question: string; answer: string;
  language: string; uncertain?: boolean; evidence_frame_ids?: string[]; demo?: boolean;
};

export function toEntry(q: ServerQuestion): Entry | null {
  if (!q || typeof q.question_id !== 'string' || typeof q.session_id !== 'string' || typeof q.question !== 'string'
    || typeof q.answer !== 'string' || (q.language !== 'en' && q.language !== 'ar') || !Number.isFinite(Date.parse(q.asked_at))) return null;
  // The local store keeps the shape it already uses for spoken answers; `demo` stays true for every row it holds.
  return { id: q.question_id, sessionId: q.session_id, questionId: q.question_id, question: q.question, answer: q.answer,
    language: q.language, createdAt: new Date(q.asked_at).toISOString(), demo: true, input: 'speech' };
}

export async function fetchServerHistory(origin: string, fetcher: typeof fetch, limit = 50): Promise<{ entries: Entry[]; demo: boolean } | null> {
  try {
    const response = await boundedFetch(`${origin}/api/v1/questions?limit=${limit}`,
      { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } }, 8000, fetcher);
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !Array.isArray(body.questions)) return null;
    return { entries: body.questions.map(toEntry).filter((e: Entry | null): e is Entry => e !== null), demo: body.demo === true };
  } catch {
    return null;
  }
}
