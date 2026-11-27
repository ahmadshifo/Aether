// Authenticated backend proxy forwards voice to the local Docker service.
export const voiceClient = {
  // Resolves to an in-memory WAV object URL; the caller revokes it when done.
  async synthesize(text, language) {
    let response;
    try {
      response = await fetch('/api/v1/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: language }),
      });
    } catch {
      throw new Error("Can't reach the voice service. Is it running on port 8001?");
    }
    if (!response.ok) {
      // Loading models and unavailable services use the shared error shape.
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message
        ?? `Couldn't get the spoken answer (HTTP ${response.status}). Is the voice service running on port 8001?`);
    }
    return URL.createObjectURL(await response.blob());
  },
};
