import type { Language } from '../types';
export async function ask(base: string, sessionId: string, questionId: string, question: string,
  language: Language, signal: AbortSignal, request: typeof fetch = fetch) {
  const url = new URL(`${base.replace(/\/$/, '')}/api/v1/ask`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('AI URL requires HTTP(S)');
  const response = await request(url.toString(), {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, question_id: questionId, question, language }),
  });
  if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
  const data = await response.json();
  if (data.question_id !== questionId || data.language !== language || typeof data.answer !== 'string'
    || !data.answer.trim() || typeof data.uncertain !== 'boolean'
    || !Array.isArray(data.evidence_frame_ids) || !data.evidence_frame_ids.every((id: unknown) => typeof id === 'string')) {
    throw new Error('AI response does not match api-v1');
  }
  return data.answer.trim() as string;
}
