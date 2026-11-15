// Spellings the phone's offline English recognizer writes for "Hey Aether". It stays on the device, so the phrase
// must be said as in English. The list comes from real tries on a Samsung A53: the recognizer often hears the name
// as another word ("Hey Ethan", "Hey Acer", "Hey sir", "Hey eater"), so those count as the wake phrase too.
const NAME = 'aether|ether|either|ather|eather|aither|ethan|esther|eater|eta|ethel|acer|asir|sir|ezer|ethos';
// "Hey" may come out as "hay", "hi" or "hei", and the recognizer may put a comma or full stop after it.
const PHRASE = new RegExp(String.raw`\b(hey|hay|hi|hei)[\s,.!]+(${NAME})\b`, 'i');
// "Hey Aether" said quickly can come out as one word.
const ONE_WORD = /\bheather\b/i;
// Asks the recognizer to expect this phrase instead of a similar-sounding ordinary word.
export const WAKE_PHRASES = ['Hey Aether', 'Hey Ether', 'Aether'];
// The recognizer can deliver "Hey" and the name as separate results, so the previous one counts too.
export const heardWakeWord = (text: string, previous = '') => {
  const heard = `${previous} ${text}`;
  return PHRASE.test(heard) || ONE_WORD.test(heard);
};
