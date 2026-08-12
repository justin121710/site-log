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

// ---------- 本機草稿（不用 AI）----------
//
// 依分類把記錄分派到日報五段。規則是寫死的，只搬運使用者自己打的字，
// 一個字都不會多。比 AI 版粗糙，但它不可能編造，也不需要網路或額度。
//
// 一筆記錄可以同時落在多個段落——同一個動作本來就可能既是施工也是材料查驗。

/** 一級分類 → 第一段（工程進行情況）。自訂分類也算施工作業。 */
const CONSTRUCTION_CATS = new Set([
  'temp', 'survey', 'foundation', 'rebar', 'formwork', 'concrete', 'prestress',
  'steel', 'bridge', 'hydraulic', 'culvert', 'coating', 'waterproof', 'building',
]);

/** 這些關鍵詞出現在子項或內文時，該筆同時歸進對應段落。 */
const SECTION_HINTS = {
  // 施拉與灌漿是預力工程的檢驗停留點，跟一般抽查同一段
  s2: /檢驗停留點|停留點|查驗|抽查|抽驗|複驗|放樣|軸線|圖說|施工圖|自主檢查|施拉|伸長量|灌漿|水密試驗|試水/,
  s3: /材料|試驗|試體|坍度|氯離子|送審|抽樣|檢測|出廠|規格|品質|進場|膜厚|附著力|非破壞/,
  s4: /安全|衛生|護欄|防護|動火|局限空間|吊掛|防護具|安衛|臨水|交維/,
  s5: /缺失|異常|不符合|改正|通知|指示|會勘|爭議|停工/,
};

function entryLine(entry) {
  const place = [entry.floor, entry.gridline, entry.area].filter(Boolean).join(' ');
  const body = (entry.ai?.tidied || entry.transcript || entry.note || '').trim().replace(/\s*\n\s*/g, '　');
  if (!body && !place) return null;
  return `・${place ? `${place}：` : ''}${body || '（無文字說明）'}`;
}

/** 這筆記錄要進哪幾段。 */
function sectionsFor(entry) {
  const hay = [
    ...entry.subtags,
    entry.ai?.tidied || '',
    entry.transcript || '',
    entry.note || '',
  ].join(' ');

  const hit = new Set();
  if (entry.categoryIds.some((c) => CONSTRUCTION_CATS.has(c))) hit.add('s1');
  if (entry.categoryIds.includes('survey') || SECTION_HINTS.s2.test(hay)) hit.add('s2');
  if (entry.categoryIds.includes('material') || SECTION_HINTS.s3.test(hay)) hit.add('s3');
  if (entry.categoryIds.includes('safety') || SECTION_HINTS.s4.test(hay)) hit.add('s4');
  if (entry.categoryIds.includes('defect') || SECTION_HINTS.s5.test(hay)) hit.add('s5');

  // 什麼都沒對上的，寧可放進第一段讓他自己搬，也不要讓它整筆消失
  if (!hit.size) hit.add('s1');
  return hit;
}

/**
 * 完全在本機產生日報草稿。
 * @returns {{ s1,s2,s3,s4,s5, freeSummary }}
 */
export function buildLocalDraft({ entries }) {
  const buckets = { s1: [], s2: [], s3: [], s4: [], s5: [] };
  const sorted = [...entries].sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));

  for (const e of sorted) {
    const line = entryLine(e);
    if (!line) continue;
    for (const s of sectionsFor(e)) buckets[s].push(line);
  }

  const out = {};
  for (const k of ['s1', 's2', 's3', 's4', 's5']) {
    out[k] = buckets[k].length ? [...new Set(buckets[k])].join('\n') : '本日無';
  }

  // 給自己看的：你自己寫的備註，加上還沒查證的 AI 內容
  const notes = sorted.filter((e) => e.note?.trim())
    .map((e) => `・${[e.floor, e.gridline].filter(Boolean).join(' ')}${e.floor ? '：' : ''}${e.note.trim()}`);
  const unverified = sorted.filter((e) => e.ai && !e.verified).length;
  if (unverified) notes.push(`・今天有 ${unverified} 筆 AI 整理的內容還沒查證，記得問前輩或查規範。`);
  out.freeSummary = notes.join('\n');

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
