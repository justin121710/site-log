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

table.list { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 10pt; }
table.list th, table.list td { border: 1px solid #666; padding: 1.4mm 2mm; text-align: left; vertical-align: top; }
table.list th { background: #f0f0f0; font-weight: 600; }
table.list .nw { white-space: nowrap; }
.daymeta { font-size: 10pt; color: #444; margin: 0 0 2mm; }
.tl { margin-bottom: 1.5mm; }
.tl .tag { display: inline-block; padding: .3mm 1.5mm; border: 1px solid #111; border-radius: 1.5mm; font-size: 8.5pt; }

.foot { margin-top: 8mm; font-size: 9.5pt; color: #555; border-top: 1px solid #bbb; padding-top: 2mm; }
.sign { margin-top: 10mm; display: flex; gap: 12mm; font-size: 10.5pt; }
.sign div { flex: 1; border-top: 1px solid #111; padding-top: 2mm; }

.page-break { break-before: page; }

@page { size: A4; margin: 12mm; }
@media print {
  body { padding: 0; }
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

// ---------- 期間報表（週報／月報）----------

/** 把記錄依日期分組，日期由早到晚。 */
function byDate(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => [date, list.sort((x, y) => (x.capturedAt || '').localeCompare(y.capturedAt || ''))]);
}

function entryRows(list) {
  return list.map((e) => {
    const place = placeOf(e);
    const body = (e.ai?.tidied || e.transcript || e.note || '').trim();
    return `<tr>
<td class="nw">${esc(fmtTime(e.capturedAt))}</td>
<td class="nw">${esc(e.categoryIds.map(categoryName).join('、'))}</td>
<td class="nw">${esc(place)}</td>
<td>${esc(body)}${e.defectNo ? ` <b>[${esc(e.defectNo)}]</b>` : ''}</td>
</tr>`;
  }).join('');
}

const LIST_TABLE_HEAD = '<tr><th class="nw">時間</th><th class="nw">工項</th><th class="nw">位置</th><th>內容</th></tr>';

/**
 * @param {{project, from, to, entries, days, perPage?, withPhotos?}} opts
 */
export async function buildPeriodReportHtml({ project, from, to, entries, days = {}, perPage, withPhotos = true }) {
  if (!entries.length) throw new Error('這段期間沒有記錄');
  const grouped = byDate(entries);
  const site = formatSite(project?.site);

  // 統計：出工人數與各工項出現次數，這是週月報最常被問的兩件事
  let manpower = 0;
  let manDays = 0;
  const catCount = new Map();
  for (const [date, list] of grouped) {
    const d = days[date];
    const n = Number(d?.manpower);
    if (Number.isFinite(n) && n > 0) { manpower += n; manDays++; }
    for (const e of list) {
      for (const c of e.categoryIds) catCount.set(c, (catCount.get(c) || 0) + 1);
    }
  }
  const topCats = [...catCount.entries()].sort((a, b) => b[1] - a[1]);

  let html = '<h1>監造工作彙整報表</h1>';
  html += headTable([
    ['工程名稱', project?.name],
    ['工　　址', site],
    ['契約編號', project?.contractNo],
    ['期　　間', `${fmtDate(from)} ～ ${fmtDate(to)}`],
    ['記錄天數', `${grouped.length} 天，共 ${entries.length} 筆`],
    ['累計出工', manDays ? `${manpower} 人次（${manDays} 天有填）` : ''],
    ['進　　度', (project?.plannedProgress || project?.actualProgress)
      ? `預定 ${project.plannedProgress || '—'}%　實際 ${project.actualProgress || '—'}%` : ''],
  ]);

  if (topCats.length) {
    html += '<h2>工項統計</h2><table class="head"><tr>'
      + topCats.map(([c, n]) => `<th>${esc(categoryName(c))}</th>`).join('')
      + '</tr><tr>'
      + topCats.map(([, n]) => `<td>${n} 筆</td>`).join('')
      + '</tr></table>';
  }

  for (const [date, list] of grouped) {
    const d = days[date] || {};
    const meta = [
      (d.weatherAM || d.weatherPM) ? `天氣 上午${d.weatherAM || '—'}／下午${d.weatherPM || '—'}` : '',
      d.manpower ? `出工 ${d.manpower} 人` : '',
      d.contractors ? `廠商 ${d.contractors}` : '',
    ].filter(Boolean).join('　');
    html += `<h2>${esc(fmtDate(date))}</h2>`;
    if (meta) html += `<div class="daymeta">${esc(meta)}</div>`;
    html += `<table class="list">${LIST_TABLE_HEAD}${entryRows(list)}</table>`;
  }

  let photoCount = 0;
  if (withPhotos) {
    const sheet = await buildPhotoSheet(entries, project, {
      perPage, title: `施工照片表　${fmtDate(from)} ～ ${fmtDate(to)}`, pageBreak: true,
    });
    html += sheet.html;
    photoCount = sheet.count;
  }

  html += footNote();
  const label = project?.code || project?.name || '專案';
  return {
    html: shell(`監造彙整報表 ${from}~${to}`, html),
    filename: `監造彙整_${label}_${from}_${to}.html`,
    photos: photoCount,
  };
}

// ---------- 缺失追蹤表 ----------

/**
 * @param {{project, groups, perPage?, withPhotos?}} opts groups 來自 db.groupDefects()
 */
export async function buildDefectReportHtml({ project, groups, perPage, withPhotos = true }) {
  if (!groups.length) throw new Error('這個專案還沒有填單號的缺失記錄');

  let html = '<h1>缺失追蹤表</h1>';
  html += headTable([
    ['工程名稱', project?.name],
    ['工　　址', formatSite(project?.site)],
    ['契約編號', project?.contractNo],
    ['統　　計', `共 ${groups.length} 件　`
      + ['開立', '改正中', '已複驗'].map((s) => `${s} ${groups.filter((g) => g.status === s).length} 件`).join('　')],
  ]);

  html += '<table class="list"><tr>'
    + '<th class="nw">單號</th><th class="nw">開立日</th><th class="nw">狀態</th>'
    + '<th class="nw">位置</th><th>內容與改正情形</th></tr>';
  for (const g of groups) {
    const first = g.entries[0];
    const timeline = g.entries.map((e) => {
      const body = (e.ai?.tidied || e.transcript || e.note || '').trim();
      return `<div class="tl"><b>${esc(fmtDate(e.date))}</b>`
        + `${e.defectStatus ? ` <span class="tag">${esc(e.defectStatus)}</span>` : ''} ${esc(body)}</div>`;
    }).join('');
    html += `<tr>
<td class="nw"><b>${esc(g.no)}</b></td>
<td class="nw">${esc(g.openedAt)}</td>
<td class="nw">${esc(g.status)}</td>
<td class="nw">${esc(placeOf(first))}</td>
<td>${timeline}</td>
</tr>`;
  }
  html += '</table>';

  let photoCount = 0;
  if (withPhotos) {
    // 一件缺失一段照片，改正前後才會排在一起看得出差別
    for (const g of groups) {
      const sheet = await buildPhotoSheet(g.entries, project, {
        perPage, title: `缺失 ${g.no}　${g.status}`, pageBreak: true,
      });
      html += sheet.html;
      photoCount += sheet.count;
    }
  }

  html += footNote();
  const label = project?.code || project?.name || '專案';
  return {
    html: shell('缺失追蹤表', html),
    filename: `缺失追蹤表_${label}.html`,
    photos: photoCount,
  };
}

// ---------- 單一工項彙整（可跨專案）----------

/**
 * @param {{categoryId, categoryLabel, entries, projectsById, perPage?, withPhotos?}} opts
 */
export async function buildCategoryReportHtml({
  categoryId, categoryLabel, entries, projectsById = {}, perPage, withPhotos = true,
}) {
  if (!entries.length) throw new Error('這個工項還沒有記錄');

  // 依專案分組，A 案場與 B 案場的做法才排得起來比對
  const byProject = new Map();
  for (const e of entries) {
    const key = e.projectId || '';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(e);
  }

  let html = `<h1>${esc(categoryLabel || categoryName(categoryId))}　工項彙整</h1>`;
  html += headTable([
    ['工　　項', categoryLabel || categoryName(categoryId)],
    ['涵蓋專案', `${byProject.size} 個`],
    ['記錄筆數', `${entries.length} 筆`],
  ]);

  let photoCount = 0;
  for (const [pid, list] of byProject) {
    const p = projectsById[pid];
    const name = pid ? (p?.name || '（已刪除的專案）') : '未歸專案';
    const site = formatSite(p?.site);
    html += `<h2>${esc(name)}${site ? `　${esc(site)}` : ''}</h2>`;
    const sorted = [...list].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));
    html += `<table class="list"><tr><th class="nw">日期</th><th class="nw">位置</th>`
      + `<th class="nw">關鍵詞</th><th>內容</th></tr>`
      + sorted.map((e) => `<tr>
<td class="nw">${esc(e.date)}</td>
<td class="nw">${esc(placeOf(e))}</td>
<td class="nw">${esc(e.subtags.join('、'))}</td>
<td>${esc((e.ai?.tidied || e.transcript || e.note || '').trim())}</td>
</tr>`).join('')
      + '</table>';

    if (withPhotos) {
      const sheet = await buildPhotoSheet(sorted, p, { perPage, title: `${name}　照片`, pageBreak: false });
      html += sheet.html;
      photoCount += sheet.count;
    }
  }

  html += footNote();
  return {
    html: shell(`${categoryLabel || categoryName(categoryId)} 工項彙整`, html),
    filename: `工項彙整_${categoryLabel || categoryName(categoryId)}.html`,
    photos: photoCount,
  };
}

// ---------- 專案完整本 ----------

export async function buildProjectBookHtml({ project, entries, days = {}, perPage, withPhotos = true }) {
  if (!entries.length) throw new Error('這個專案還沒有記錄');
  const grouped = byDate(entries);
  const dates = grouped.map(([d]) => d);

  let html = '<h1>監造記錄完整本</h1>';
  html += headTable([
    ['工程名稱', project?.name],
    ['工　　址', formatSite(project?.site)],
    ['契約編號', project?.contractNo],
    ['主辦機關', project?.agency],
    ['監造單位', project?.supervisorUnit],
    ['承　　商', project?.contractor],
    ['開工日期', project?.startDate],
    ['預定竣工', project?.plannedEndDate],
    ['記錄範圍', `${fmtDate(dates[0])} ～ ${fmtDate(dates[dates.length - 1])}`],
    ['記錄總數', `${grouped.length} 天，共 ${entries.length} 筆`],
  ]);

  let photoCount = 0;
  for (const [date, list] of grouped) {
    const d = days[date] || {};
    const meta = [
      (d.weatherAM || d.weatherPM) ? `天氣 上午${d.weatherAM || '—'}／下午${d.weatherPM || '—'}` : '',
      d.manpower ? `出工 ${d.manpower} 人` : '',
    ].filter(Boolean).join('　');
    html += `<h2>${esc(fmtDate(date))}</h2>`;
    if (meta) html += `<div class="daymeta">${esc(meta)}</div>`;
    html += `<table class="list">${LIST_TABLE_HEAD}${entryRows(list)}</table>`;
    if (withPhotos) {
      const sheet = await buildPhotoSheet(list, project, { perPage, title: '', pageBreak: false });
      html += sheet.html;
      photoCount += sheet.count;
    }
  }

  html += footNote();
  const label = project?.code || project?.name || '專案';
  return {
    html: shell('監造記錄完整本', html),
    filename: `監造記錄完整本_${label}.html`,
    photos: photoCount,
  };
}

function footNote() {
  return `<div class="foot">由「監造工地筆記」產生於 ${new Date().toLocaleString('zh-TW')}。`
    + `本表為現場記錄整理，正式送審請依主辦機關規定之格式與程序辦理。</div>`;
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
