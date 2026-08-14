// 法規全文查詢。
//
// 這一支跟 AI 完全無關，也刻意如此：模型永遠不准引用條號（編出來的條號看起來
// 最像真的、最少人會去翻），但把「真正的條文原文」擺在使用者面前讓他自己讀，
// 風險是相反的——他讀到的每個字都是法規本身。
//
// 資料是 data/laws.json，由 tools/make-laws.mjs 產生，跟著 service worker
// 一起快取，所以工地沒訊號一樣查得到。中文不需要斷詞，直接掃子字串就夠快
// （862 條、42 萬字，在手機上是幾毫秒的事）。
//
// **法規會修訂。** 所以每一條都帶著它的最新異動日期，畫面上永遠顯示，
// 並且附官方連結讓他核對。過期的條文比查不到更危險，因為它一樣權威。

const PACK_URL = 'data/laws.json';

let packPromise = null;

/** 整包法規。只載一次，之後留在記憶體。 */
export function loadLaws() {
  if (!packPromise) {
    packPromise = fetch(PACK_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`載不到法規包（HTTP ${r.status}）`);
        return r.json();
      })
      .catch((err) => {
        packPromise = null; // 失敗不要卡住，下次還能再試
        throw new Error(`法規包載入失敗：${err.message}`);
      });
  }
  return packPromise;
}

export async function lawPackInfo() {
  const pack = await loadLaws();
  return {
    source: pack.source,
    note: pack.note,
    dataDate: pack.dataDate,
    laws: pack.laws.map((l) => ({ name: l.name, url: l.url, updated: l.updated, count: l.articles.length })),
    articles: pack.laws.reduce((n, l) => n + l.articles.length, 0),
  };
}

/** 查詢字串切成關鍵詞。空白分隔，全部都要命中（AND）。 */
export function parseQuery(q) {
  return (q || '').trim().split(/[\s、,，]+/).filter(Boolean).slice(0, 5);
}

/**
 * @param {string} q
 * @param {{ limit?: number, pcode?: string }} opts
 * @returns {Promise<{ hits: object[], total: number, words: string[] }>}
 */
export async function searchLaws(q, { limit = 60, pcode = '' } = {}) {
  const words = parseQuery(q);
  if (!words.length) return { hits: [], total: 0, words };

  const pack = await loadLaws();
  const out = [];

  for (const law of pack.laws) {
    if (pcode && law.pcode !== pcode) continue;
    for (const a of law.articles) {
      // 條號也一起找，這樣「第 15 條」或「15」也查得到
      const hay = `${a.no}\n${a.text}`;
      let score = 0;
      let all = true;
      for (const w of words) {
        const n = countOf(hay, w);
        if (!n) { all = false; break; }
        score += n;
      }
      if (!all) continue;
      // 條文越短、命中越多，越可能就是他要的那一條
      out.push({ law: law.name, url: law.url, updated: law.updated, ...a, score: score / Math.sqrt(a.text.length) });
    }
  }

  out.sort((x, y) => y.score - x.score);
  return { hits: out.slice(0, limit), total: out.length, words };
}

function countOf(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

/**
 * 把命中的關鍵詞包成 <mark>。回傳 DocumentFragment，
 * 不用 innerHTML——條文是外部資料，不該有機會變成標記。
 */
export function highlight(text, words) {
  const frag = document.createDocumentFragment();
  if (!words.length) { frag.append(text); return frag; }

  const re = new RegExp(words.map(escapeRe).join('|'), 'g');
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    frag.append(mark);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 20251219 → 2025-12-19 */
export function fmtLawDate(d) {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || '';
}
