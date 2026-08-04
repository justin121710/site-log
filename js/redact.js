// 送出前的去識別化層。
//
// 兩件事：
//   1. 代號替換 —— 依對照表把真實名稱換成代號。對照表本身永遠不上傳。
//   2. 敏感詞掃描 —— 替換完之後再掃一次，命中就提醒使用者，讓他決定要不要送。
//
// 這一層不保證安全，只是把「不小心送出去」的機率壓低。真正的判斷還是在使用者身上。

import { getSetting, setSetting, listProjects } from './db.js';

export async function getAliases() {
  return (await getSetting('aliases', [])).map((a) => ({ ...a }));
}

export async function setAliases(list) {
  return setSetting('aliases', list);
}

export async function getExtraSensitive() {
  return getSetting('sensitiveTerms', []);
}

export async function setExtraSensitive(list) {
  return setSetting('sensitiveTerms', list);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 依對照表替換。長的字串先換，避免「○○營造股份有限公司」被「○○營造」先吃掉半截。
 * @returns {{ text: string, hits: string[] }}
 */
export function applyAliases(text, aliases) {
  if (!text) return { text: '', hits: [] };
  const sorted = [...aliases]
    .filter((a) => a.from && a.to)
    .sort((a, b) => b.from.length - a.from.length);
  let out = text;
  const hits = [];
  for (const a of sorted) {
    const re = new RegExp(escapeRe(a.from), 'g');
    if (re.test(out)) {
      hits.push(`${a.from} → ${a.to}`);
      out = out.replace(re, a.to);
    }
  }
  return { text: out, hits };
}

/** 顯示時把代號換回真名。 */
export function revertAliases(text, aliases) {
  if (!text) return '';
  let out = text;
  for (const a of [...aliases].sort((x, y) => y.to.length - x.to.length)) {
    if (!a.from || !a.to) continue;
    out = out.replace(new RegExp(escapeRe(a.to), 'g'), a.from);
  }
  return out;
}

/**
 * 自動敏感詞來源：所有專案的名稱、機關、承商、監造單位、契約編號。
 * 使用者在設定裡補的詞也一起。
 */
export async function collectSensitiveTerms() {
  const terms = new Set(await getExtraSensitive());
  for (const p of await listProjects()) {
    for (const k of ['name', 'agency', 'contractor', 'supervisorUnit', 'contractNo']) {
      const v = (p[k] || '').trim();
      if (v.length >= 2) terms.add(v);
    }
  }
  return [...terms];
}

/** @returns {string[]} 命中的敏感詞 */
export function scanSensitive(text, terms) {
  if (!text) return [];
  return terms.filter((t) => t && text.includes(t));
}

/**
 * 完整的送出前處理：替換 → 掃描。
 * @returns {{ text, aliasHits: string[], sensitiveHits: string[] }}
 */
export async function prepareForUpload(text) {
  const aliases = await getAliases();
  const { text: redacted, hits: aliasHits } = applyAliases(text, aliases);
  const terms = await collectSensitiveTerms();
  // 已經被代號取代掉的字就不必再警告一次
  const stillSensitive = scanSensitive(redacted, terms);
  return { text: redacted, aliasHits, sensitiveHits: stillSensitive };
}
