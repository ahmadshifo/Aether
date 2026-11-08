// Pulls the account's questions and answers from the AI backend (GET /api/v1/questions) into the phone's
// History cache. Sample records are never imported as real account answers.
// Uses the same login cookie as /api/v1/streams. Failures leave the local list as it is.
import { boundedFetch } from '../platform/config.ts';
import { parseAnswer } from '../services/teamApi.ts';
import type { Entry } from '../shared/types';

type ServerQuestion = {
  question_id: string; session_id: string; asked_at: string; question: string; answer: string;
  language: string; uncertain?: boolean; evidence_frame_ids?: string[]; demo?: boolean;
};

export function toEntry(q: ServerQuestion): Entry | null {
  if (!q || typeof q.question_id !== 'string' || typeof q.session_id !== 'string' || typeof q.question !== 'string'
    || q.demo === true || typeof q.answer !== 'string' || !['en', 'ar', 'fr'].includes(q.language) || !Number.isFinite(Date.parse(q.asked_at))
    || ![q.question_id, q.session_id].every(id => /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))) return null;
  const language = q.language as Entry['language'];
  try { parseAnswer(q, { session_id: q.session_id, question_id: q.question_id, question: q.question, language }); } catch { return null; }
  return { id: q.question_id, sessionId: q.session_id, questionId: q.question_id, question: q.question, answer: q.answer,
    language, createdAt: new Date(q.asked_at).toISOString(), provenance: 'server', input: 'speech', uncertain: q.uncertain!, evidenceFrameIds: [...new Set(q.evidence_frame_ids!)] };
}

export type HistoryPage = { entries: Entry[]; nextCursor: string | null; demo: boolean };
export function createHistoryApi(origin: string, fetcher: typeof fetch, unauthorized: () => void = () => {}) {
  async function request(suffix: string, method: 'GET' | 'DELETE', signal: AbortSignal) {
    const response = await boundedFetch(`${origin}/api/v1/questions${suffix}`, {
      method, signal, credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' },
    }, 8000, fetcher);
    if (signal.aborted) throw Error('cancelled');
    if (response.status === 401) { unauthorized(); throw Error('not_authenticated'); }
    if (!response.ok) throw Error('history_unavailable');
    return response.json();
  }
  return {
    async page(cursor: string | null, signal: AbortSignal, limit = 20): Promise<HistoryPage> {
      const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, limit))) });
      if (cursor) params.set('cursor', cursor);
      const body = await request(`?${params}`, 'GET', signal);
      if (!body || !Array.isArray(body.questions) || body.questions.length > 100
        || !(body.next_cursor == null || typeof body.next_cursor === 'string' && body.next_cursor.length > 0 && body.next_cursor.length <= 2048)) throw Error('history_invalid');
      // Demo rows mean this account has no real records. They are never cached or displayed.
      if (body.demo === true) return { entries: [], nextCursor: null, demo: true };
      const entries = body.questions.filter((row: ServerQuestion | null) => row?.demo !== true).map(toEntry);
      if (entries.some((entry: Entry | null) => !entry)) throw Error('history_invalid');
      return { entries, nextCursor: body.next_cursor ?? null, demo: false };
    },
    async clear(signal: AbortSignal): Promise<number> {
      const body = await request('', 'DELETE', signal);
      if (!Number.isSafeInteger(body?.deleted) || body.deleted < 0) throw Error('history_invalid');
      return body.deleted;
    },
  };
}
// Compatibility for the command-line integration verifier.
export async function fetchServerHistory(origin: string, fetcher: typeof fetch, limit = 50): Promise<{ entries: Entry[]; demo: boolean } | null> {
  try { const page = await createHistoryApi(origin, fetcher).page(null, new AbortController().signal, limit); return page.demo ? null : page; }
  catch { return null; }
}
