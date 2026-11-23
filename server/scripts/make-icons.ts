// Writes the PWA icons into client/public (indigo square + white check mark). Run: npx tsx scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x4f, 0x46, 0xe5];
const FG = [0xff, 0xff, 0xff];
// Check mark polyline in unit coordinates, stroke width relative to size. Kept inside the maskable safe zone.
const POINTS: [number, number][] = [[0.3, 0.52], [0.44, 0.66], [0.71, 0.37]];
const STROKE = 0.085;

function distToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number) {
  const rows: Buffer[] = [];
  const ss = 4; // 4×4 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const px = (x + (sx + 0.5) / ss) / size, py = (y + (sy + 0.5) / ss) / size;
          const d = Math.min(distToSegment(px, py, POINTS[0], POINTS[1]), distToSegment(px, py, POINTS[1], POINTS[2]));
          if (d <= STROKE / 2) hit++;
        }
      const a = hit / (ss * ss);
      for (let ch = 0; ch < 3; ch++) row[1 + x * 3 + ch] = Math.round(BG[ch] * (1 - a) + FG[ch] * a);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../../client/public/', import.meta.url);
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
  writeFileSync(new URL(name, out), png(size));
  console.log('wrote', name);
}
