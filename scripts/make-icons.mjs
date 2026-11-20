// Draws the app icons (the favicon's logo) as PNGs, with no image libraries.
// Run with `node scripts/make-icons.mjs` after changing the logo.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const BG = [13, 11, 20];
const PINK = [255, 126, 182];
const VIOLET = [167, 139, 250];
// Logo in a 64x64 box: rounded square (radius 16) and a triangle (24,18)-(48,32)-(24,46).
function inRoundedSquare(u, v) {
  const r = 16, cx = Math.min(Math.max(u, r), 64 - r), cy = Math.min(Math.max(v, r), 64 - r);
  return u >= 0 && v >= 0 && u <= 64 && v <= 64 && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
function inTriangle(u, v) {
  const side = (ax, ay, bx, by) => (bx - ax) * (v - ay) - (by - ay) * (u - ax);
  const a = side(24, 18, 48, 32), b = side(48, 32, 24, 46), c = side(24, 46, 24, 18);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}
function icon(size, { maskable = false } = {}) {
  const scale = maskable ? 0.8 : 1; // maskable icons keep the logo inside the safe zone
  const box = size * scale, offset = (size - box) / 2, S = 4; // 4x4 samples per pixel for smooth edges
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = ((x + (sx + 0.5) / S) - offset) / box * 64, v = ((y + (sy + 0.5) / S) - offset) / box * 64;
      let col = null;
      if (inTriangle(u, v) && inRoundedSquare(u, v)) {
        const t = Math.min(1, Math.max(0, (u + v) / 128));
        col = PINK.map((p, i) => p + (VIOLET[i] - p) * t);
      } else if (inRoundedSquare(u, v) || maskable) col = BG;
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = S * S, cover = a / 255;
    return cover ? [Math.round(r / cover), Math.round(g / cover), Math.round(b / cover), Math.round(a / n)] : [0, 0, 0, 0];
  });
}
writeFileSync('public/icons/icon-192.png', icon(192));
writeFileSync('public/icons/icon-512.png', icon(512));
writeFileSync('public/icons/icon-maskable-512.png', icon(512, { maskable: true }));
console.log('icons written');
