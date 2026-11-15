#!/usr/bin/env node
// Generates the PWA icons (PNG) with no dependencies: anti-aliased signed-distance
// rendering of a "pulse" line on a dark tile, encoded with zlib.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');
mkdirSync(out, { recursive: true });

// Pulse/price line in unit coordinates (0..1)
const PULSE = [[0.16, 0.6], [0.34, 0.6], [0.42, 0.4], [0.51, 0.72], [0.6, 0.3], [0.68, 0.53], [0.84, 0.53]];
const END = [0.84, 0.53];

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function lineDist(px, py, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, ...pts[i], ...pts[i + 1]));
  return d;
}
function roundRectSdf(px, py, half, r) {
  const qx = Math.abs(px - 0.5) - half + r;
  const qy = Math.abs(py - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v) => Math.max(0, Math.min(1, v));

/**
 * mode: 'any' (rounded tile), 'maskable' (full bleed, art in safe zone), 'badge' (white line on transparent)
 */
function render(size, mode) {
  const px = new Uint8Array(size * size * 4);
  const scale = mode === 'maskable' ? 0.72 : mode === 'badge' ? 1.1 : 1;
  const stroke = (mode === 'badge' ? 0.1 : 0.068) / 2;
  const aa = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      // background
      let r = 0, g = 0, b = 0, a = 0;
      if (mode !== 'badge') {
        const cov = mode === 'maskable' ? 1 : clamp(0.5 - roundRectSdf(u, v, 0.5, 0.22) / aa);
        // vertical gradient #101b2c → #0a0f17
        r = mix(16, 10, v); g = mix(27, 15, v); b = mix(44, 23, v); a = cov;
      }
      // foreground line, scaled around the centre
      const lu = (u - 0.5) / scale + 0.5;
      const lv = (v - 0.5) / scale + 0.5;
      const d = Math.min(lineDist(lu, lv, PULSE) - stroke, Math.hypot(lu - END[0], lv - END[1]) - stroke * 1.55);
      const fg = clamp(0.5 - (d * scale) / aa);
      if (mode === 'badge') {
        r = g = b = 255; a = fg;
      } else if (fg > 0) {
        // mint #2bd9a0
        r = mix(r, 43, fg); g = mix(g, 217, fg); b = mix(b, 160, fg);
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r); px[i + 1] = Math.round(g); px[i + 2] = Math.round(b); px[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(join(out, 'icon-192.png'), render(192, 'any'));
writeFileSync(join(out, 'icon-512.png'), render(512, 'any'));
writeFileSync(join(out, 'maskable-512.png'), render(512, 'maskable'));
writeFileSync(join(out, 'badge-96.png'), render(96, 'badge'));

const pts = PULSE.map(([x, y]) => `${(x * 64).toFixed(1)},${(y * 64).toFixed(1)}`).join(' ');
writeFileSync(join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101b2c"/><stop offset="1" stop-color="#0a0f17"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><polyline points="${pts}" fill="none" stroke="#2bd9a0" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${END[0] * 64}" cy="${END[1] * 64}" r="3.4" fill="#2bd9a0"/></svg>\n`);
console.log('✓ icons written to', out);
