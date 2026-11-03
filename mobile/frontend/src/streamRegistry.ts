/**
 * Tell the AI backend which live/<session ID> this signed-in account is publishing,
 * so the web dashboard's Connect button finds the stream without a link.
 * Best effort: streaming never waits for, or fails because of, these calls.
 */
function report(action: 'start' | 'stop', sessionId: string): void {
  void fetch(`/api/v1/streams/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
    keepalive: true,
  }).catch(() => {})
}

export const reportStreamStart = (sessionId: string) => report('start', sessionId)
export const reportStreamStop = (sessionId: string) => report('stop', sessionId)
