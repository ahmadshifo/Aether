// Browser-compatible base64 helpers; no files or filesystem APIs.
export function decode64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export function encode64(value: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < value.length; i += 8192) raw += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(raw);
}
export function wav16(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wav = new Uint8Array(44 + size), view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, size, true);
  let offset = 44;
  for (const chunk of chunks) { wav.set(chunk, offset); offset += chunk.length; }
  return wav;
}

export class UtteranceBuffer {
  private chunks: Uint8Array[] = [];
  private leading: Uint8Array[] = [];
  private samples = 0;
  private voiced = 0;
  private silence = 0;
  push(pcm: Uint8Array, rms: number): Uint8Array | null {
    const count = pcm.length / 2;
    if (rms >= 0.015) {
      if (!this.chunks.length) {
        this.chunks.push(...this.leading); this.samples = this.leading.reduce((sum, item) => sum + item.length / 2, 0);
        this.leading = [];
      }
      this.voiced += count; this.silence = 0;
    } else if (!this.chunks.length) {
      this.leading.push(pcm);
      while (this.leading.reduce((sum, item) => sum + item.length, 0) > 9600) this.leading.shift();
      return null;
    } else this.silence += count;
    this.chunks.push(pcm); this.samples += count;
    if (this.samples >= 240000 || this.silence >= 10400) {
      const result = this.voiced >= 2400 ? wav16(this.chunks) : null;
      this.clear(); return result;
    }
    return null;
  }
  clear() { this.chunks = []; this.leading = []; this.samples = 0; this.voiced = 0; this.silence = 0; }
}
