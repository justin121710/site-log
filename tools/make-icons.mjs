// 從 tools/logo.svg 產生 App 圖示。不用任何外部套件：
// 自己解析 SVG path、自己掃描線填色、自己編 PNG。
//
// 用法：node tools/make-icons.mjs
// 換圖示只要換掉 tools/logo.svg 再跑一次。

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'icons');
const SVG = join(HERE, 'logo.svg');

const BG = [0x12, 0x16, 0x1c];   // 跟 App 深色背景一致
const FG = [0xff, 0x9d, 0x4d];   // 強調色
const SS = 4;                    // 超取樣倍率，邊緣才不會有鋸齒

// iOS 會把圖示裁成圓角，Android 的 maskable 甚至裁成圓形（安全區是內接圓的 80%）。
// 這個圖形的外廓本來就接近圓形，所以佔到 74% 仍然在安全區內，
// 又不會像 66% 那樣四周空一大圈。
const CONTENT = 0.74;

// ---------- SVG path 解析 ----------

/** 把 d 字串切成「指令 + 數字」。 */
function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : Number(m[2]));
  return out;
}

/**
 * 解析成一組封閉子路徑（點陣列）。貝茲曲線在這裡就攤平成折線。
 * @param {number} pxPerUnit 用來決定曲線要切多細
 */
function parsePath(d, pxPerUnit) {
  const t = tokenize(d);
  const subpaths = [];
  let cur = [];
  let x = 0; let y = 0;      // 目前點
  let sx = 0; let sy = 0;    // 子路徑起點
  let px = null; let py = null; // 前一個 cubic 的第二控制點，給 S/s 用
  let cmd = null;
  let i = 0;

  const moveTo = (nx, ny) => {
    if (cur.length > 1) subpaths.push(cur);
    cur = [[nx, ny]];
    x = nx; y = ny; sx = nx; sy = ny;
  };
  const lineTo = (nx, ny) => { cur.push([nx, ny]); x = nx; y = ny; };

  const cubicTo = (x1, y1, x2, y2, nx, ny) => {
    // 控制多邊形長度決定切幾段，短曲線不必浪費點數
    const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(nx - x2, ny - y2);
    const steps = Math.min(220, Math.max(6, Math.ceil((len * pxPerUnit) / 2)));
    const x0 = x; const y0 = y;
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const v = 1 - u;
      cur.push([
        v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * nx,
        v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * ny,
      ]);
    }
    px = x2; py = y2;
    x = nx; y = ny;
  };

  while (i < t.length) {
    if (typeof t[i] === 'string') { cmd = t[i]; i++; }
    const rel = cmd === cmd.toLowerCase();
    const n = () => t[i++];

    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = n(); const ny = n();
        moveTo(rel ? x + nx : nx, rel ? y + ny : ny);
        cmd = rel ? 'l' : 'L'; // 後續座標視為 lineto
        px = py = null;
        break;
      }
      case 'L': { const nx = n(); const ny = n(); lineTo(rel ? x + nx : nx, rel ? y + ny : ny); px = py = null; break; }
      case 'H': { const nx = n(); lineTo(rel ? x + nx : nx, y); px = py = null; break; }
      case 'V': { const ny = n(); lineTo(x, rel ? y + ny : ny); px = py = null; break; }
      case 'C': {
        const a = n(); const b = n(); const c = n(); const dd = n(); const e = n(); const f = n();
        cubicTo(rel ? x + a : a, rel ? y + b : b, rel ? x + c : c, rel ? y + dd : dd,
          rel ? x + e : e, rel ? y + f : f);
        break;
      }
      case 'S': {
        const c = n(); const dd = n(); const e = n(); const f = n();
        // 平滑接續：第一控制點是前一個第二控制點對目前點的鏡射
        const x1 = px === null ? x : 2 * x - px;
        const y1 = py === null ? y : 2 * y - py;
        cubicTo(x1, y1, rel ? x + c : c, rel ? y + dd : dd, rel ? x + e : e, rel ? y + f : f);
        break;
      }
      case 'Z': {
        if (cur.length > 1) subpaths.push(cur);
        cur = [];
        x = sx; y = sy;
        px = py = null;
        // Z 之後如果還有數字，代表新的子路徑從起點開始
        if (typeof t[i] === 'number') cur = [[x, y]];
        break;
      }
      default:
        throw new Error(`還沒支援的 SVG path 指令：${cmd}（logo.svg 請先在編輯器裡轉成只有 M/L/H/V/C/S/Z）`);
    }
  }
  if (cur.length > 1) subpaths.push(cur);
  return subpaths;
}

// ---------- 掃描線填色（even-odd）----------

/**
 * 所有子路徑一起算交點，這就是 fill-rule="evenodd"：
 * 眼睛、嘴巴那些內圈才會變成挖空的洞而不是實心。
 */
function rasterize(subpaths, w, h) {
  const mask = new Uint8Array(w * h);
  const edges = [];
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length; i++) {
      const [x1, y1] = sp[i];
      const [x2, y2] = sp[(i + 1) % sp.length];
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

// ---------- PNG ----------

const CRC = (() => {
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
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
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

export function writePng(file, rgb, w, h = w) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolor
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------- 組裝 ----------

const svg = readFileSync(SVG, 'utf8');
const ds = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
if (!ds.length) throw new Error('logo.svg 裡找不到 <path d="…">');

const vb = /viewBox="([\d.\-\s]+)"/.exec(svg);
const [vx, vy, vw, vh] = vb
  ? vb[1].trim().split(/\s+/).map(Number)
  : [0, 0, Number(/width="([\d.]+)"/.exec(svg)?.[1] || 24), Number(/height="([\d.]+)"/.exec(svg)?.[1] || 24)];

export function render(size) {
  const W = size * SS;
  const scale = (W * CONTENT) / Math.max(vw, vh);
  const offX = (W - vw * scale) / 2 - vx * scale;
  const offY = (W - vh * scale) / 2 - vy * scale;

  const subpaths = [];
  for (const d of ds) {
    for (const sp of parsePath(d, scale)) {
      subpaths.push(sp.map(([x, y]) => [x * scale + offX, y * scale + offY]));
    }
  }

  const mask = rasterize(subpaths, W, W);

  // 超取樣縮回輸出尺寸，順便得到邊緣的覆蓋率當作抗鋸齒
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) hit += mask[(y * SS + sy) * W + (x * SS + sx)];
      }
      const a = hit / (SS * SS);
      const o = (y * size + x) * 3;
      for (let ch = 0; ch < 3; ch++) rgb[o + ch] = Math.round(BG[ch] * (1 - a) + FG[ch] * a);
    }
  }
  return rgb;
}

// 被別的腳本 import 時不要順手把檔案寫出去（例如只想預覽某個尺寸）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const size of [180, 192, 512]) {
    const file = join(OUT, `icon-${size}.png`);
    writePng(file, render(size), size);
    console.log('wrote', file);
  }
}
