// 產生可列印的單檔 HTML 報表。
//
// 為什麼是 HTML 而不是直接產 PDF：真的產 PDF 要嵌入中文字型，一套 5–15MB，
// 塞進這個 App 會毀掉「離線可用、開得快」。而 iOS 內建就能把網頁列印成 PDF，
// 中文完美、零額外程式碼。所以我們產 HTML，PDF 交給系統。
//
// 照片一律內嵌成 data URI，這樣單一個檔案就是完整的報表，
// 傳給別人、丟進雲端硬碟、幾年後再打開都不會變成一堆破圖。

import { fmtDate, fmtTime } from './ui.js';
import { categoryName } from './taxonomy.js';
import { formatSite } from './twzones.js';
import { REPORT_SECTIONS } from './gemini.js';
import { listMedia } from './db.js';

// 報表裡的照片另外縮，不動原圖。原圖照樣完整留在備份 zip 裡。
// 1000px 在 A4 半頁上印出來已經看得出鋼筋間距與量測讀數。
const REPORT_PHOTO_EDGE = 1000;
const REPORT_PHOTO_QUALITY = 0.82;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** 縮圖並轉成 data URI。整份報表的體積幾乎都在這裡決定。 */
async function photoDataUri(blob) {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, REPORT_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', REPORT_PHOTO_QUALITY);
}

/** 一張照片在報表上要顯示的圖說：自己的 > 記錄的整理稿 > 逐字稿 > 備註。 */
function captionFor(media, entry) {
  const own = (media.caption || '').trim();
  if (own) return own;
  return (entry.ai?.tidied || entry.transcript || entry.note || '').trim();
}

function placeOf(entry) {
  return [entry.floor, entry.gridline, entry.area].filter(Boolean).join(' · ');
}

// ---------- 版面 ----------

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 16mm 14mm;
  font: 12pt/1.6 "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
  color: #111; background: #fff;
}
h1 { font-size: 17pt; margin: 0 0 4mm; text-align: center; letter-spacing: .05em; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1.5px solid #111; }
table.head { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 10.5pt; }
table.head th, table.head td { border: 1px solid #666; padding: 1.6mm 2.5mm; text-align: left; vertical-align: top; }
table.head th { background: #f0f0f0; white-space: nowrap; width: 22mm; font-weight: 600; }
.section { margin-bottom: 4mm; }
.section .body { white-space: pre-wrap; padding: 2mm 0 0 2mm; min-height: 8mm; }
.none { color: #777; }
.sheet-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 0 0 4mm; }

/* 施工照片表：一格一張，圖說在照片正下方，跟公共工程的慣例一致 */
.photos { display: grid; gap: 6mm; }
.photos.per2 { grid-template-columns: 1fr; }
.photos.per4 { grid-template-columns: 1fr 1fr; }
.pcell { border: 1px solid #666; padding: 3mm; break-inside: avoid; }
.pcell img { width: 100%; height: auto; display: block; background: #eee; }
.pcell .meta { margin-top: 2mm; font-size: 9.5pt; line-height: 1.5; }
.pcell .meta b { display: inline-block; min-width: 12mm; }
.pcell .tag {
  display: inline-block; padding: .5mm 2mm; margin-right: 2mm;
  border: 1px solid #111; border-radius: 2mm; font-size: 9pt; font-weight: 700;
}
.pcell .cap { margin-top: 1mm; }

.foot { margin-top: 8mm; font-size: 9.5pt; color: #555; border-top: 1px solid #bbb; padding-top: 2mm; }
.sign { margin-top: 10mm; display: flex; gap: 12mm; font-size: 10.5pt; }
.sign div { flex: 1; border-top: 1px solid #111; padding-top: 2mm; }

.page-break { break-before: page; }

@page { size: A4; margin: 12mm; }
@media print {
  body { padding: 0; }
  .noprint { display: none !important; }
}

.noprint {
  position: sticky; top: 0; background: #fffbe6; border: 1px solid #d9c88a;
  padding: 3mm 4mm; margin: 0 0 6mm; font-size: 10.5pt; border-radius: 2mm;
}
.noprint button {
  font: inherit; padding: 2mm 4mm; margin-left: 3mm; cursor: pointer;
  border: 1px solid #666; border-radius: 2mm; background: #fff;
}
`;

function headTable(rows) {
  return `<table class="head">${rows
    .filter(([, v]) => String(v ?? '').trim())
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

function shell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
<div class="noprint">
  <b>要存成 PDF：</b>用瀏覽器的分享鍵（□↑）→ 列印 → 兩指在預覽圖上外推 → 分享 → 儲存到檔案。
  這一段字不會被印出去。
  <button onclick="window.print()">直接列印</button>
</div>
${bodyHtml}
</body></html>`;
}

// ---------- 每日報 ----------

/**
 * @param {{ project, day, date, sections, freeSummary, entries, perPage?: 2|4, withPhotos?: boolean }} opts
 * @returns {Promise<{ html: string, filename: string, photos: number }>}
 */
export async function buildDailyReportHtml(opts) {
  const { project, day = {}, date, sections = {}, freeSummary = '', entries = [] } = opts;
  const perPage = opts.perPage === 4 ? 4 : 2;
  const withPhotos = opts.withPhotos !== false;

  const site = formatSite(project?.site);
  const planned = day.plannedProgress || project?.plannedProgress;
  const actual = day.actualProgress || project?.actualProgress;

  let html = '<h1>公共工程監造日報表</h1>';
  html += headTable([
    ['工程名稱', project?.name],
    ['工　　址', site],
    ['契約編號', project?.contractNo],
    ['主辦機關', project?.agency],
    ['監造單位', project?.supervisorUnit],
    ['承　　商', project?.contractor],
    ['填報日期', fmtDate(date)],
    ['本日天氣', (day.weatherAM || day.weatherPM) ? `上午 ${day.weatherAM || '—'}　下午 ${day.weatherPM || '—'}` : ''],
    ['在場廠商', day.contractors],
    ['出工人數', day.manpower],
    ['主要機具', day.equipment],
    ['進　　度', (planned || actual) ? `預定 ${planned || '—'}%　實際 ${actual || '—'}%` : ''],
  ]);

  for (const s of REPORT_SECTIONS) {
    const body = (sections[s.key] || '').trim();
    html += `<div class="section"><h2>${esc(s.title)}</h2>`
      + `<div class="body${body ? '' : ' none'}">${esc(body || '本日無')}</div></div>`;
  }

  if (freeSummary.trim()) {
    html += `<div class="section"><h2>今日心得・待追蹤（個人筆記，不屬於表報內容）</h2>`
      + `<div class="body">${esc(freeSummary.trim())}</div></div>`;
  }

  html += '<div class="sign"><div>監造人員</div><div>主任技師／主管</div></div>';

  let photoCount = 0;
  if (withPhotos) {
    const sheet = await buildPhotoSheet(entries, project, {
      perPage,
      title: `施工照片表　${fmtDate(date)}`,
      pageBreak: true,
    });
    html += sheet.html;
    photoCount = sheet.count;
  }

  html += `<div class="foot">由「監造工地筆記」產生於 ${new Date().toLocaleString('zh-TW')}。`
    + `本表為現場記錄整理，正式送審請依主辦機關規定之格式與程序辦理。</div>`;

  const label = project?.code || project?.name || '專案';
  return {
    html: shell(`監造日報 ${date}`, html),
    filename: `監造日報_${label}_${date}.html`,
    photos: photoCount,
  };
}

// ---------- 施工照片表 ----------

/**
 * @param {object[]} entries
 * @param {object} project
 * @param {{ perPage?: 2|4, title?: string, pageBreak?: boolean }} opts
 */
export async function buildPhotoSheet(entries, project, opts = {}) {
  const perPage = opts.perPage === 4 ? 4 : 2;
  const sorted = [...entries].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));

  const cells = [];
  for (const e of sorted) {
    const media = (await listMedia(e.id)).filter((m) => m.kind === 'photo');
    for (const m of media) {
      const src = await photoDataUri(m.blob);
      if (!src) continue;
      const place = placeOf(e);
      const cap = captionFor(m, e);
      cells.push(`<div class="pcell">
<img src="${src}" alt="">
<div class="meta">
${m.tag ? `<span class="tag">${esc(m.tag)}</span>` : ''}
<b>日期</b>${esc(fmtDate(e.date))} ${esc(fmtTime(e.capturedAt))}<br>
${place ? `<b>位置</b>${esc(place)}<br>` : ''}
${e.categoryIds.length ? `<b>工項</b>${esc(e.categoryIds.map(categoryName).join('、'))}<br>` : ''}
${e.defectNo ? `<b>缺失單</b>${esc(e.defectNo)}<br>` : ''}
${cap ? `<div class="cap">${esc(cap)}</div>` : ''}
</div></div>`);
    }
  }

  if (!cells.length) return { html: '', count: 0 };

  const title = opts.title || '施工照片表';
  const html = `<div class="${opts.pageBreak ? 'page-break' : ''}">`
    + `<div class="sheet-title">${esc(title)}</div>`
    + (project?.name ? `<div style="text-align:center;font-size:10.5pt;margin-bottom:4mm">${esc(project.name)}`
      + `${formatSite(project.site) ? `　${esc(formatSite(project.site))}` : ''}</div>` : '')
    + `<div class="photos per${perPage}">${cells.join('')}</div></div>`;

  return { html, count: cells.length };
}

/** 獨立的施工照片表（不含日報本文）。 */
export async function buildPhotoSheetHtml({ project, date, entries, perPage }) {
  const sheet = await buildPhotoSheet(entries, project, {
    perPage,
    title: `施工照片表　${date ? fmtDate(date) : ''}`.trim(),
  });
  if (!sheet.count) throw new Error('這個範圍裡沒有照片');

  const label = project?.code || project?.name || '專案';
  return {
    html: shell(`施工照片表 ${date || ''}`.trim(), sheet.html),
    filename: `施工照片表_${label}${date ? `_${date}` : ''}.html`,
    photos: sheet.count,
  };
}
