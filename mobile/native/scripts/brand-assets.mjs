// Rasterize the existing Mono two-eye geometric mark; no new visual design.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crc = bytes => { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; };
function chunk(name, data) { const type = Buffer.from(name), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); type.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc(Buffer.concat([type, data])), out.length - 4); return out; }
function render(adaptive) {
  const size = 1024, mark = adaptive ? 620 : 760, offset = (size - mark) / 2, stride = size * 4 + 1, raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = [252, 252, 252, adaptive ? 0 : 255];
    const mx = (x - offset) / mark, my = (y - offset) / mark;
    if (mx >= 0 && mx < 1 && my >= 0 && my < 1) {
      color = [32, 32, 32, 255];
      for (const left of [.28, .59]) {
        const ex = mx - left - .065, ey = Math.max(.43, Math.min(.57, my));
        if (ex * ex + (my - ey) ** 2 <= .065 ** 2) color = [255, 255, 255, 255];
      }
    }
    raw.set(color, y * stride + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const adaptive of [false, true]) writeFileSync(new URL(`../assets/${adaptive ? 'adaptive-icon' : 'icon'}.png`, import.meta.url), render(adaptive));
