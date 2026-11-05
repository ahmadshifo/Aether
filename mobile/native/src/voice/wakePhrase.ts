// Spellings the English recognizer writes for "Hey Aether". It stays on the device, so the phrase must be said as in English.
const PHRASE = /\b(hey|hay|hi)\s+(aether|ether|either|ather|eather|ethan|esther|aither)\b/i;
// Asks the recognizer to expect this phrase instead of a similar-sounding ordinary word.
export const WAKE_PHRASES = ['Hey Aether', 'Hey Ether', 'Aether'];
// The recognizer can deliver "Hey" and the name as separate results, so the previous one counts too.
export const heardWakeWord = (text: string, previous = '') => PHRASE.test(`${previous} ${text}`);
