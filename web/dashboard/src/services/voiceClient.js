// Member 2: asks Member 1's voice service to read an answer aloud; Vite forwards /api/v1/voice to it on :8001.
export const voiceClient = {
  // Resolves to an object URL for the MP3; the caller revokes it when done.
  async synthesize(text, language) {
    let response;
    try {
      response = await fetch('/api/v1/voice/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
      });
    } catch {
      throw new Error("Can't reach the voice service. Is it running on port 8001?");
    }
    if (!response.ok) {
      throw new Error(`Couldn't get the spoken answer (HTTP ${response.status}). Is the voice service running on port 8001?`);
    }
    return URL.createObjectURL(await response.blob());
  },
};
