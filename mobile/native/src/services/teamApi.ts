import { boundedFetch } from '../platform/config.ts';
import { parseUser } from '../auth/authClient.ts';
import type { Language } from '../shared/types.ts';

export type AskRequest = { session_id: string; question_id: string; question: string; language: Language };
export type AskResponse = { question_id: string; answer: string; language: Language; uncertain: boolean; evidence_frame_ids: string[] };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function parseAnswer(value: unknown, request: AskRequest): AskResponse {
  const answer = value as Partial<AskResponse> | null;
  if (!answer || answer.question_id !== request.question_id || answer.language !== request.language
    || typeof answer.answer !== 'string' || !answer.answer.trim() || answer.answer.length > 32000
    || typeof answer.uncertain !== 'boolean' || !Array.isArray(answer.evidence_frame_ids)
    || answer.evidence_frame_ids.length > 100 || !answer.evidence_frame_ids.every(uuid)) throw Error('answer_invalid');
  return { question_id: answer.question_id, answer: answer.answer, language: answer.language,
    uncertain: answer.uncertain, evidence_frame_ids: [...new Set(answer.evidence_frame_ids)] };
}
export function createTeamApi(origin: string, fetcher: typeof fetch = fetch, onUnauthorized = () => {}, timeoutMs = 20000) {
  async function send(path: string, method: string, body: unknown, signal: AbortSignal) {
    let response: Response;
    try { response = await boundedFetch(origin + path, { method, signal, credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeoutMs, fetcher); }
    catch { throw Error(signal.aborted ? 'cancelled' : 'server_unavailable'); }
    if (signal.aborted) throw Error('cancelled');
    if (response.status === 401) { onUnauthorized(); throw Error('auth_lost'); }
    if ([404, 405, 501].includes(response.status)) throw Error(path.endsWith('/ask') ? 'answers_unavailable' : 'profile_unavailable');
    if (response.status === 422 && path.endsWith('/ask')) {
      const detail = await response.json().catch(() => null);
      const languageRejected = /\blanguage\b/i.test(detail?.error?.message ?? '') || detail?.detail?.some?.((item: { loc?: string[] }) => item.loc?.includes('language'));
      throw Error(languageRejected ? 'server_language_unavailable' : 'answer_invalid');
    }
    if (response.status === 429) throw Error('server_busy');
    if (!response.ok) throw Error('server_unavailable');
    return response.json().catch(() => { throw Error('answer_invalid'); });
  }
  return {
    async ask(request: AskRequest, signal: AbortSignal): Promise<AskResponse> {
      if (!uuid(request.session_id) || !uuid(request.question_id) || !request.question.trim() || request.question.length > 4000 || !['en', 'ar', 'fr'].includes(request.language)) throw Error('answer_invalid');
      return parseAnswer(await send('/api/v1/ask', 'POST', request, signal), request);
    },
    async updateName(name: string, userId: string, signal: AbortSignal) {
      name = name.trim();
      if (!name || [...name].length > 80) throw Error('invalid_name');
      const user = parseUser(await send('/api/v1/auth/me', 'PATCH', { name }, signal));
      if (user.user_id !== userId) throw Error('profile_invalid');
      return user;
    },
  };
}
export type Availability = 'available' | 'missing' | 'unknown';
export type TeamFeatures = Record<'answers' | 'history' | 'profile' | 'streams', Availability>;
export const unknownFeatures: TeamFeatures = { answers: 'unknown', history: 'unknown', profile: 'unknown', streams: 'unknown' };
// Presence in OpenAPI proves that a route is mounted, not that AI/DB providers work.
export async function inspectTeamApi(origin: string, fetcher: typeof fetch = fetch): Promise<TeamFeatures> {
  try {
    const response = await boundedFetch(`${origin}/openapi.json`, { credentials: 'omit' }, 5000, fetcher);
    if (!response.ok) return { ...unknownFeatures };
    const schema = await response.json();
    if (!schema?.paths || typeof schema.paths !== 'object') return { ...unknownFeatures };
    const route = (path: string, method: string): Availability => schema.paths[path]?.[method] ? 'available' : 'missing';
    return { answers: route('/api/v1/ask', 'post'), history: route('/api/v1/questions', 'get'),
      profile: route('/api/v1/auth/me', 'patch'), streams: route('/api/v1/streams/start', 'post') };
  } catch { return { ...unknownFeatures }; }
}
