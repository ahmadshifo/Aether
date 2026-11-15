// Private provider settings go only to the AI backend, never into Expo's public environment.
export function answerEnvironment(config) {
  return Object.fromEntries(['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL']
    .filter(key => typeof config[key] === 'string' && config[key].trim())
    .map(key => [key, config[key].trim()]));
}
