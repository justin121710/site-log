// 跨專案全文搜尋。
//
// 這是把「一堆記錄」變成「紀錄庫」的那一步。在這之前只能從工項分類進去、
// 用子項標籤篩，想找「上次那個墊塊脫落是哪個案子哪一天」只能逐頁翻。
//
// 純本機、離線可用、不經過任何服務。中文不需要斷詞，直接掃子字串——
// 幾百筆記錄在手機上是毫秒級的事，不值得為它建索引。

import { getAll, listProjects } from './db.js';
import { categoryName } from './taxonomy.js';
import { parseQuery } from './ui.js';

/** 一筆記錄裡可以被搜到的欄位。標題是為了讓結果說得出「是哪裡對到的」。 */
const FIELDS = [
  { key: 'transcript', title: '逐字稿', get: (e) => e.transcript },
  { key: 'tidied', title: 'AI 整理', get: (e) => e.ai?.tidied },
  { key: 'note', title: '備註', get: (e) => e.note },
  { key: 'verifiedNote', title: '依據', get: (e) => e.verifiedNote },
  { key: 'place', title: '位置', get: (e) => [e.floor, e.gridline, e.area].filter(Boolean).join(' ') },
  { key: 'subtags', title: '關鍵詞', get: (e) => (e.subtags || []).join('、') },
  { key: 'defectNo', title: '缺失單號', get: (e) => e.defectNo },
  // 經驗重點含 AI 推論，搜得到但結果要標出來，不要跟他自己寫的字混在一起
  { key: 'lesson', title: '經驗重點（AI 推論）', inferred: true, get: (e) => e.lesson
    && [e.lesson.workItem, e.lesson.situation, e.lesson.cause, e.lesson.action].filter(Boolean).join('\n') },
];

function countOf(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

/** 命中處前後各留一段，讓他一眼看出上下文，不用點進去才知道是不是要找的。 */
function snippet(text, words, span = 40) {
  const flat = text.replace(/\s*\n\s*/g, '　');
  let at = -1;
  for (const w of words) {
    const i = flat.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return flat.slice(0, span * 2);
  const from = Math.max(0, at - span);
  const to = Math.min(flat.length, at + span);
  return (from ? '…' : '') + flat.slice(from, to) + (to < flat.length ? '…' : '');
}

/**
 * @param {string} q
 * @param {{ projectId?: string, categoryId?: string, limit?: number }} opts
 * @returns {Promise<{ hits: object[], total: number, words: string[], scanned: number }>}
 */
export async function searchEntries(q, { projectId = '', categoryId = '', limit = 80 } = {}) {
  const words = parseQuery(q);
  const entries = await getAll('entries');
  if (!words.length) return { hits: [], total: 0, words, scanned: entries.length };

  const projects = Object.fromEntries((await listProjects()).map((p) => [p.id, p]));
  const out = [];

  for (const e of entries) {
    if (projectId && e.projectId !== projectId) continue;
    if (categoryId && !(e.categoryIds || []).includes(categoryId)) continue;

    // 先把整筆併起來判斷 AND，不然「保護層 墊塊」分別落在兩個欄位就會漏掉
    const parts = FIELDS.map((f) => ({ f, text: (f.get(e) || '').trim() })).filter((x) => x.text);
    const hay = parts.map((x) => x.text).join('\n');
    let score = 0;
    let all = true;
    for (const w of words) {
      const n = countOf(hay, w);
      if (!n) { all = false; break; }
      score += n;
    }
    if (!all) continue;

    // 挑一個「最能代表這次命中」的欄位來當摘要：優先他自己寫的字
    const hitField = parts.find((x) => words.some((w) => x.text.includes(w))) || parts[0];

    out.push({
      id: e.id,
      date: e.date,
      capturedAt: e.capturedAt,
      projectName: e.projectId ? (projects[e.projectId]?.name || '（已刪除的專案）') : '未歸專案',
      categories: (e.categoryIds || []).map(categoryName),
      defectNo: e.defectNo || '',
      field: hitField.f.title,
      inferred: !!hitField.f.inferred,
      text: snippet(hitField.text, words),
      score,
    });
  }

  // 同分時新的排前面——工地找東西通常是找最近發生的
  out.sort((a, b) => b.score - a.score || (b.capturedAt || '').localeCompare(a.capturedAt || ''));
  return { hits: out.slice(0, limit), total: out.length, words, scanned: entries.length };
}
