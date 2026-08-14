// 日報的格式集中在這裡。
//
// 目前用的是「公共工程監造日報表」的通用格式（臺北市政府工程施工及驗收基準 附表6，
// 各機關版本大同小異）。等你上工拿到公司的制式表格，只要改這個檔，
// 不用動 App 其他任何地方。

import { fmtDate, fmtTime } from './ui.js';
import { categoryName } from './taxonomy.js';
import { REPORT_SECTIONS } from './gemini.js';
import { formatSite } from './twzones.js';

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

/** 這些關鍵詞出現在某一行時，那一行歸進對應段落。 */
const SECTION_HINTS = {
  // 施拉與灌漿是預力工程的檢驗停留點，跟一般抽查同一段
  s2: /檢驗停留點|停留點|查驗|抽查|抽測|抽驗|複驗|放樣|軸線|圖說|施工圖|自主檢查|施拉|伸長量|灌漿|水密試驗|試水/,
  s3: /材料|試驗|試體|坍度|氯離子|送審|抽樣|檢測|出廠|規格|品質|進場|膜厚|附著力|非破壞/,
  s4: /安全|衛生|護欄|防護|動火|局限空間|吊掛|防護具|安衛|臨水|交維/,
  // 「不足、脫落、鬆脫」這種寫法在工地就是在講缺失，不會每次都乖乖寫「缺失」兩個字
  s5: /缺失|異常|不符合|不足|脫落|鬆脫|破損|滲漏|改正|待改善|通知|指示|會勘|爭議|停工/,
};

/** 一筆記錄裡「這一段是不是它的預設歸屬」——整行都沒對到關鍵詞時才用得上。 */
function fallbackSection(entry) {
  if (entry.categoryIds.some((c) => CONSTRUCTION_CATS.has(c))) return 's1';
  if (entry.categoryIds.includes('material')) return 's3';
  if (entry.categoryIds.includes('safety')) return 's4';
  if (entry.categoryIds.includes('defect')) return 's5';
  if (entry.categoryIds.includes('survey')) return 's2';
  return 's1'; // 什麼都對不上的，寧可放進第一段讓他自己搬，也不要整行消失
}

/** 記錄的內文拆成一行一件事。AI 整理本來就是條列式，行首的「・」在這裡吃掉。 */
function entryLines(entry) {
  const body = (entry.ai?.tidied || entry.transcript || entry.note || '').trim();
  return body
    .split('\n')
    .map((s) => s.replace(/^[・·•*\-\s]+/, '').trim())
    .filter(Boolean);
}

/**
 * 這一行要進哪幾段。
 *
 * 逐行判斷而不是整筆判斷：一筆記錄常常同時講了施工、材料、安全、缺失，
 * 整筆丟的話同樣的八行會在三段裡各印一次，日報就沒法看了。
 */
function sectionsForLine(line, entry) {
  const hit = new Set();
  for (const s of ['s2', 's3', 's4', 's5']) {
    if (SECTION_HINTS[s].test(line)) hit.add(s);
  }

  // 缺失的處理過程幾乎一定會提到「複驗」，但那是缺失追蹤的一部分，
  // 不是「監督依圖說施工」。不擋的話同一句會在第二段與第五段各印一次。
  if (hit.has('s5')) hit.delete('s2');

  // 施工類的記錄，只要這一行不是在講材料、安全或缺失，就是當天的施工進度。
  // 抽查（s2）與施工進度（s1）本來就會同時成立，那個重複是對的。
  const isConstruction = entry.categoryIds.some((c) => CONSTRUCTION_CATS.has(c));
  if (isConstruction && !hit.has('s3') && !hit.has('s4') && !hit.has('s5')) hit.add('s1');

  if (!hit.size) hit.add(fallbackSection(entry));
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
    const place = [e.floor, e.gridline, e.area].filter(Boolean).join(' ');
    const lines = entryLines(e);
    if (!lines.length && place) lines.push('（無文字說明）');

    // 位置在每一段只掛一次，掛在這筆記錄在那一段的第一行。
    // 每行都重複「P3 靠河側：」讀起來像壞掉的複製貼上，完全不掛又不知道在講哪裡。
    const headed = new Set();
    for (const line of lines) {
      for (const s of sectionsForLine(line, e)) {
        buckets[s].push(`・${!headed.has(s) && place ? `${place}：` : ''}${line}`);
        headed.add(s);
      }
    }
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
  const site = formatSite(project.site);
  if (site) L.push(`工　　址：${site}`);
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
