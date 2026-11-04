// Preference only: actual codec support and negotiated media remain device facts.
export function preferH264<T extends { mimeType: string }>(getCapabilities: (() => { codecs: T[] } | null) | undefined, setPreferences: ((codecs: T[]) => void) | undefined) {
  try {
    const codecs = getCapabilities?.()?.codecs;
    if (!codecs || !setPreferences) return;
    const preferred = codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264');
    if (preferred.length) setPreferences([...preferred, ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264')]);
  } catch { /* Older devices may omit or reject the optional codec capability API. */ }
}
