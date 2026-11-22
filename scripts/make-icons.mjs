// Draws the app icons (the favicon's logo) as PNGs, with no image libraries.
// Run with `node scripts/make-icons.mjs` after changing the logo.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
};
function png(w, h, pixel) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const INK = [8, 9, 10];
// The brand colour: animee's lime, cinemee's red or mangee's neon yellow (see the bottom of this file).
let LIME = [198, 255, 61];
// The colour at a point of the logo (u, v in 0..64): one colour, or a blend for my space.
let FILL = null;
const fill = (u, v) => (FILL ? FILL(u, v) : LIME);
// Logo in a 64x64 box, matching public/favicon.svg: a lime rounded square (radius 16) with the
// ^^. face in ink: two chevrons drawn as round-capped strokes, and a dot.
function inRoundedSquare(u, v) {
  const r = 16, cx = Math.min(Math.max(u, r), 64 - r), cy = Math.min(Math.max(v, r), 64 - r);
  return u >= 0 && v >= 0 && u <= 64 && v <= 64 && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
function nearSegment(u, v, ax, ay, bx, by, half) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
  return (u - ax - t * dx) ** 2 + (v - ay - t * dy) ** 2 <= half * half;
}
const STROKES = [[9, 38, 16, 26], [16, 26, 23, 38], [31, 38, 38, 26], [38, 26, 45, 38]];
function inFace(u, v) {
  if (STROKES.some(([ax, ay, bx, by]) => nearSegment(u, v, ax, ay, bx, by, 2.75))) return true;
  return (u - 53.5) ** 2 + (v - 38.6) ** 2 <= 3.4 ** 2;
}
function icon(size, { maskable = false } = {}) {
  const scale = maskable ? 0.8 : 1; // maskable icons keep the logo inside the safe zone
  const box = size * scale, offset = (size - box) / 2, S = 4; // 4x4 samples per pixel for smooth edges
  return png(size, size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = ((x + (sx + 0.5) / S) - offset) / box * 64, v = ((y + (sy + 0.5) / S) - offset) / box * 64;
      let col = null;
      if (inRoundedSquare(u, v)) col = inFace(u, v) ? INK : fill(u, v);
      else if (maskable) col = fill(u, v); // the maskable icon fills its whole square
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = S * S, cover = a / 255;
    return cover ? [Math.round(r / cover), Math.round(g / cover), Math.round(b / cover), Math.round(a / n)] : [0, 0, 0, 0];
  });
}
// Share image (1200x630) for link previews: the mark, large, glowing on ink.
function ogImage() {
  const W = 1200, H = 630, box = 300, left = (W - box) / 2, top = (H - box) / 2, S = 3;
  return png(W, H, (x, y) => {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
      const u = (px - left) / box * 64, v = (py - top) / box * 64;
      let col;
      if (inRoundedSquare(u, v)) col = inFace(u, v) ? INK : fill(u, v);
      else {
        // Ink with a soft lime glow around the mark.
        const d = Math.hypot(px - W / 2, py - H / 2);
        const glow = Math.max(0, 1 - d / 420) ** 2 * 0.32;
        col = INK.map((c, i) => c + (LIME[i] - c) * glow);
      }
      r += col[0]; g += col[1]; b += col[2];
    }
    const n = S * S;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255];
  });
}
function writeSet(colour, dir, blend = null) {
  LIME = colour;
  FILL = blend;
  mkdirSync(`${dir}/icons`, { recursive: true });
  writeFileSync(`${dir}/og.png`, ogImage());
  writeFileSync(`${dir}/icons/icon-192.png`, icon(192));
  writeFileSync(`${dir}/icons/icon-512.png`, icon(512));
  writeFileSync(`${dir}/icons/icon-maskable-512.png`, icon(512, { maskable: true }));
}
writeSet([198, 255, 61], 'public');                // animee: lime
writeSet([255, 61, 82], 'public/sites/cinemee');   // cinemee: red (served for cinemee.animee.space)
writeSet([255, 232, 31], 'public/sites/mangee');   // mangee: neon yellow (mangee.animee.space)
// my space (the desktop app and my.animee.space): all three colours, lime to red to yellow
// along the diagonal.
const STOPS = [[198, 255, 61], [255, 61, 82], [255, 232, 31]];
function threeWay(u, v) {
  const t = Math.min(1, Math.max(0, (u + v) / 128)) * 2, i = Math.min(1, Math.floor(t)), f = t - i;
  return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f));
}
writeSet([255, 61, 82], 'public/sites/my', threeWay);
mkdirSync('desktop/build', { recursive: true });
FILL = threeWay;
writeFileSync('desktop/build/icon.png', icon(512));
console.log('icons written');
