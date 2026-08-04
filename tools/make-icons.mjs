// 產生 App 圖示（鋼筋網格）。不用任何外部套件，只靠 node 內建的 zlib 寫 PNG。
// 用法：node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [0x12, 0x16, 0x1c];
const BAR = [0xff, 0x9d, 0x4d];
const TIE = [0xff, 0xd2, 0xa8];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const px = Buffer.alloc(size * size * 3);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, BG);

  // 四直四橫的鋼筋，模擬柱主筋 + 箍筋
  const bar = Math.max(3, Math.round(size * 0.085));
  const margin = Math.round(size * 0.17);
  const span = size - margin * 2;
  const n = 4;
  const gap = span / (n - 1);

  for (let k = 0; k < n; k++) {
    const p = Math.round(margin + k * gap);
    for (let d = 0; d < bar; d++) {
      for (let y = margin - bar; y <= size - margin + bar; y++) set(p + d - (bar >> 1), y, BAR);
      for (let x = margin - bar; x <= size - margin + bar; x++) set(x, p + d - (bar >> 1), BAR);
    }
  }

  // 交叉點的紮線
  const tie = Math.max(2, Math.round(bar * 0.85));
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const cx = Math.round(margin + a * gap);
      const cy = Math.round(margin + b * gap);
      for (let dy = -tie; dy <= tie; dy++) {
        for (let dx = -tie; dx <= tie; dx++) {
          if (dx * dx + dy * dy <= tie * tie) set(cx + dx, cy + dy, TIE);
        }
      }
    }
  }

  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = join(OUT, `icon-${size}.png`);
  writeFileSync(file, png(size));
  console.log('wrote', file);
}
