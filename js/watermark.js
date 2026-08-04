// 浮水印。
//
// 刻意「不燒進原圖」：IndexedDB 裡永遠是乾淨的原始照片，
// 浮水印只在顯示與匯出照片時才疊上去。燒進去就回不來了。

import { fmtDate } from './ui.js';

/** 組出要疊在照片上的兩行字。 */
export function watermarkLines(entry, project) {
  const d = new Date(entry.capturedAt || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${fmtDate(entry.date)} ${p(d.getHours())}:${p(d.getMinutes())}`;

  const place = [entry.floor, entry.gridline, entry.area].filter(Boolean).join(' · ');
  const line2 = [project?.name || '', place].filter(Boolean).join('　');

  return [stamp, line2].filter(Boolean);
}

/**
 * 把浮水印疊上去，回傳新的 JPEG Blob。原本的 blob 不會被改動。
 * @returns {Promise<Blob>}
 */
export async function applyWatermark(blob, entry, project) {
  const lines = watermarkLines(entry, project);
  if (!lines.length) return blob;

  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return blob;

  const { width: w, height: h } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  // 字級跟著圖寬走，不然大圖上的字會小到看不見
  const fs = Math.max(14, Math.round(w * 0.028));
  const pad = Math.round(fs * 0.6);
  const lineH = Math.round(fs * 1.35);
  const boxH = lineH * lines.length + pad * 2 - Math.round(fs * 0.35);

  ctx.font = `600 ${fs}px -apple-system, "Noto Sans TC", "PingFang TC", sans-serif`;
  ctx.textBaseline = 'top';

  // 半透明黑底條，保證在白牆或反光的混凝土上也讀得到
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - boxH, w, boxH);

  ctx.fillStyle = '#fff';
  lines.forEach((t, i) => {
    ctx.fillText(t, pad, h - boxH + pad + i * lineH);
  });

  return new Promise((res) => canvas.toBlob((b) => res(b || blob), 'image/jpeg', 0.9));
}
