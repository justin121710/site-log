// 把記錄轉成 Markdown。
//
// 兩個用途：
//   1. 複製單筆／單日文字，直接貼進 Notion（照片要自己拖）。
//   2. 匯出成 zip（.md + images/），走 Notion 的匯入功能，照片會一起進去。
//      Notion 只認得 zip 內的相對路徑，所以 .md 跟 images/ 必須待在同一包裡。

import { fmtDate, fmtTime } from './ui.js';
import { categoryName } from './taxonomy.js';
import { formatSite } from './twzones.js';

/**
 * 單筆記錄。
 * @param {object} entry
 * @param {string[]} imagePaths zip 內的相對路徑；複製純文字時傳空陣列
 */
export function entryToMarkdown(entry, imagePaths = []) {
  const L = [];
  const place = [entry.floor, entry.gridline, entry.area].filter(Boolean).join(' · ');

  L.push(`## ${fmtTime(entry.capturedAt)}${place ? ` · ${place}` : ''}`);
  L.push('');

  const meta = [];
  if (entry.categoryIds.length) meta.push(`**分類：**${entry.categoryIds.map(categoryName).join('、')}`);
  if (entry.subtags.length) meta.push(`**關鍵詞：**${entry.subtags.join('、')}`);
  if (meta.length) {
    L.push(meta.join('　'));
    L.push('');
  }

  // 有 AI 整理過就只放整理後的版本。原始逐字稿講的是同一件事，
  // 兩段一起輸出會讓筆記看起來像重複貼了兩次。原文不會遺失——它留在完整備份的 JSON 裡。
  const body = (entry.ai?.tidied || entry.transcript || '').trim();
  if (body) {
    L.push(bulletsToMarkdown(body));
    L.push('');
  }

  if (entry.note?.trim()) {
    L.push(`> ${entry.note.trim().split('\n').join('\n> ')}`);
    L.push('');
  }

  for (const p of imagePaths) {
    L.push(`![${place || '現場照片'}](${encodeURI(p)})`);
  }
  if (imagePaths.length) L.push('');

  if (entry.ai) {
    L.push(entry.verified
      ? `*已確認${entry.verifiedNote ? `（依據：${entry.verifiedNote}）` : ''}*`
      : '*未查證*');
    L.push('');
  }

  if (entry.gps) L.push(`<small>GPS ${entry.gps.lat}, ${entry.gps.lng}（±${entry.gps.acc}m）</small>`);

  return L.join('\n').trim();
}

/**
 * AI 整理是「・」開頭的條列，但 Markdown 不認得「・」——Notion 會把整段黏成一行。
 * 換成「- 」才會變成真的清單。
 */
function bulletsToMarkdown(text) {
  return text.split('\n').map((line) => line.replace(/^・\s*/, '- ')).join('\n');
}

/**
 * 一份完整的 Markdown 文件。
 * @param {{ title: string, project?: object, day?: object, entries: object[],
 *           imagePathsFor?: (entry) => string[] }} opts
 */
export function renderDocument({ title, project, day, entries, imagePathsFor = () => [] }) {
  const L = [`# ${title}`, ''];

  if (project) {
    const head = [];
    const site = formatSite(project.site);
    if (site) head.push(`工址：${site}`);
    if (project.contractNo) head.push(`契約編號：${project.contractNo}`);
    if (project.agency) head.push(`主辦機關：${project.agency}`);
    if (project.contractor) head.push(`承商：${project.contractor}`);
    if (head.length) {
      L.push(head.join('　'));
      L.push('');
    }
  }

  if (day && (day.weatherAM || day.weatherPM || day.contractors || day.manpower)) {
    const d = [];
    if (day.weatherAM || day.weatherPM) d.push(`天氣：上午 ${day.weatherAM || '—'}／下午 ${day.weatherPM || '—'}`);
    if (day.contractors) d.push(`在場廠商：${day.contractors}`);
    if (day.manpower) d.push(`出工人數：${day.manpower}`);
    if (day.equipment) d.push(`主要機具：${day.equipment}`);
    L.push(d.join('　'));
    L.push('');
  }

  // 時間由早到晚，讀起來才像一天的流水帳
  const sorted = [...entries].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));

  let lastDate = null;
  for (const e of sorted) {
    if (e.date !== lastDate) {
      L.push('---', '', `### ${fmtDate(e.date)}`, '');
      lastDate = e.date;
    }
    L.push(entryToMarkdown(e, imagePathsFor(e)));
    L.push('');
  }

  if (!sorted.length) L.push('（沒有記錄）');

  return L.join('\n');
}
