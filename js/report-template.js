// 日報的格式集中在這裡。
//
// 目前用的是「公共工程監造日報表」的通用格式（臺北市政府工程施工及驗收基準 附表6，
// 各機關版本大同小異）。等你上工拿到公司的制式表格，只要改這個檔，
// 不用動 App 其他任何地方。

import { fmtDate, fmtTime } from './ui.js';
import { categoryName } from './taxonomy.js';
import { REPORT_SECTIONS } from './gemini.js';

/**
 * 把當天的記錄組成要送給 AI 的素材。只有文字，照片絕對不會進來。
 */
export function buildMaterial({ project, day, entries, date }) {
  const lines = [];

  lines.push(`工程名稱：${project.code || project.name || ''}`);
  lines.push(`日期：${fmtDate(date)}`);
  if (day.weatherAM || day.weatherPM) {
    lines.push(`天氣：上午 ${day.weatherAM || '—'}／下午 ${day.weatherPM || '—'}`);
  }
  if (day.contractors) lines.push(`在場廠商：${day.contractors}`);
  if (day.manpower) lines.push(`出工人數：${day.manpower}`);
  if (day.equipment) lines.push(`主要機具：${day.equipment}`);
  if (day.plannedProgress || day.actualProgress) {
    lines.push(`進度：預定 ${day.plannedProgress || '—'}%／實際 ${day.actualProgress || '—'}%`);
  }

  lines.push('', '=== 當天的現場記錄 ===');

  // 時間由早到晚，日報讀起來才順
  const sorted = [...entries].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));

  sorted.forEach((e, i) => {
    const place = [e.floor, e.gridline, e.area].filter(Boolean).join(' ');
    const cats = e.categoryIds.map(categoryName).join('、');
    const body = [e.ai?.tidied, e.transcript, e.note]
      .map((s) => (s || '').trim())
      .filter(Boolean);

    lines.push('');
    lines.push(`--- 記錄 ${i + 1}（${fmtTime(e.capturedAt)}）---`);
    if (place) lines.push(`位置：${place}`);
    if (cats) lines.push(`工項分類：${cats}`);
    if (e.subtags.length) lines.push(`關鍵詞：${e.subtags.join('、')}`);
    // 同一段內容可能同時存在 ai.tidied 與 transcript，這裡去掉完全重複的
    lines.push(...dedupe(body));
  });

  return lines.join('\n');
}

function dedupe(list) {
  const out = [];
  for (const s of list) {
    if (!out.some((x) => x.includes(s) || s.includes(x))) out.push(s);
  }
  return out;
}

/** 產出可以整段複製貼進公司表單的純文字。 */
export function renderReportText({ project, day, date, sections, freeSummary }) {
  const L = [];
  L.push('公共工程監造日報表');
  L.push('');
  L.push(`工程名稱：${project.name || ''}`);
  if (project.contractNo) L.push(`契約編號：${project.contractNo}`);
  if (project.agency) L.push(`主辦機關：${project.agency}`);
  if (project.supervisorUnit) L.push(`監造單位：${project.supervisorUnit}`);
  L.push(`填報日期：${fmtDate(date)}`);
  L.push(`本日天氣：上午 ${day.weatherAM || ''}　下午 ${day.weatherPM || ''}`);
  if (project.contractDays) L.push(`契約工期：${project.contractDays} 天`);
  if (project.startDate) L.push(`開工日期：${project.startDate}`);
  if (project.plannedEndDate) L.push(`預定竣工日期：${project.plannedEndDate}`);
  const planned = day.plannedProgress || project.plannedProgress;
  const actual = day.actualProgress || project.actualProgress;
  if (planned || actual) L.push(`預定進度：${planned || ''}%　實際進度：${actual || ''}%`);
  if (day.contractors) L.push(`在場廠商：${day.contractors}`);
  if (day.manpower) L.push(`出工人數：${day.manpower}`);
  if (day.equipment) L.push(`主要機具：${day.equipment}`);

  L.push('');
  for (const s of REPORT_SECTIONS) {
    L.push(s.title);
    L.push((sections[s.key] || '本日無').trim());
    L.push('');
  }

  if (freeSummary?.trim()) {
    L.push('—— 以下為個人筆記，不屬於表報內容 ——');
    L.push('今日心得・待追蹤');
    L.push(freeSummary.trim());
  }

  return L.join('\n');
}
