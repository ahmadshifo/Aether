// Ignore short/noisy recognition results; only final transcripts reach the answer API.
export const validTranscript = (text: string, confidence?: number) => (text.match(/\p{L}+/gu) ?? []).length >= 2 && text.length <= 4000 && !(confidence !== undefined && confidence > 0 && confidence < 0.35);
