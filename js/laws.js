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

import { highlight, parseQuery } from './ui.js';

export { highlight };

const PACK_URL = 'data/laws.json';

// 全國法規資料庫的鏡像。實測這個網域有給 CORS，所以手機上可以直接重抓，
// 不必等我改版部署。工程會那支 API 沒有給 CORS，所以規範索引沒有這條路。
const MIRROR = 'https://raw.githubusercontent.com/kong0107/mojLawSplitJSON/gh-pages';

let packPromise = null;

/** 使用者自己更新過的那份，存在 IndexedDB。沒有就用內建的。 */
async function storedPack() {
  const { getSetting } = await import('./db.js');
  return getSetting('lawPackLocal', null);
}

/** 整包法規。只載一次，之後留在記憶體。 */
export function loadLaws() {
  if (!packPromise) {
    packPromise = (async () => {
      const mine = await storedPack();
      if (mine?.laws?.length) return mine;
      const r = await fetch(PACK_URL);
      if (!r.ok) throw new Error(`載不到法規包（HTTP ${r.status}）`);
      return r.json();
    })().catch((err) => {
      packPromise = null; // 失敗不要卡住，下次還能再試
      throw new Error(`法規包載入失敗：${err.message}`);
    });
  }
  return packPromise;
}

/**
 * 直接跟全國法規資料庫的鏡像重抓，在這台裝置上重組法規包。
 *
 * 要抓哪幾部不另外寫死——照現在這包裡有的 pcode 抓同一批，
 * 這樣清單只有一份（在 tools/make-laws.mjs 裡），不會兩邊各走各的。
 *
 * 檢查沿用工具那一套：名稱對不上、廢止了、一條都沒抓到就中止。
 * 寧可不更新，也不要讓他手上是一包爛資料。
 *
 * @param {(done: number, total: number, name: string) => void} [onStep]
 */
export async function refreshLawsFromMirror(onStep) {
  const current = await loadLaws();
  const targets = current.laws.map((l) => ({ pcode: l.pcode, name: l.name }));

  const get = async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res;
  };

  const dataDate = (await (await get(`${MIRROR}/UpdateDate.txt`)).text()).trim();
  const laws = [];
  let done = 0;

  for (const t of targets) {
    onStep?.(done, targets.length, t.name);
    const j = await (await get(`${MIRROR}/FalVMingLing/${t.pcode}.json`)).json();
    const name = j['法規名稱'];
    if (name !== t.name) throw new Error(`${t.pcode} 抓到的是「${name}」，不是「${t.name}」，這次不更新`);
    if (j['廢止註記']) throw new Error(`${name} 已廢止，這次不更新`);

    let chapter = '';
    const articles = [];
    for (const row of j['法規內容'] || []) {
      if (row['編章節']) { chapter = row['編章節'].replace(/\s+/g, ' ').trim(); continue; }
      const no = (row['條號'] || '').replace(/\s+/g, ' ').trim();
      const text = (row['條文內容'] || '').replace(/\r\n/g, '\n').trim();
      if (!no || !text) continue;
      articles.push(chapter ? { no, text, ch: chapter } : { no, text });
    }
    if (!articles.length) throw new Error(`${name} 一條都沒抓到，這次不更新`);

    laws.push({
      pcode: t.pcode,
      name,
      category: j['法規類別'] || '',
      updated: j['最新異動日期'] || '',
      url: `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${t.pcode}`,
      articles,
    });
    done++;
  }
  onStep?.(done, targets.length, '');

  const pack = {
    source: current.source,
    note: current.note,
    dataDate,
    builtAt: new Date().toISOString().slice(0, 10),
    fromDevice: true, // 這包是在裝置上組的，不是跟著 App 一起部署的
    laws,
  };

  const { setSetting } = await import('./db.js');
  await setSetting('lawPackLocal', pack);
  packPromise = Promise.resolve(pack);

  const changed = dataDate !== current.dataDate;
  return {
    dataDate,
    changed,
    laws: laws.length,
    articles: laws.reduce((n, l) => n + l.articles.length, 0),
  };
}

/** 丟掉自己更新的那份，回到跟 App 一起部署的內建版。 */
export async function resetLawsToBundled() {
  const { setSetting } = await import('./db.js');
  await setSetting('lawPackLocal', null);
  packPromise = null;
}

export async function lawPackInfo() {
  const pack = await loadLaws();
  return {
    source: pack.source,
    note: pack.note,
    dataDate: pack.dataDate,
    fromDevice: !!pack.fromDevice,
    builtAt: pack.builtAt,
    laws: pack.laws.map((l) => ({ name: l.name, url: l.url, updated: l.updated, count: l.articles.length })),
    articles: pack.laws.reduce((n, l) => n + l.articles.length, 0),
  };
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

// ---------- 施工綱要規範章節索引 ----------
//
// 只有章碼與章名，沒有內文——使用者選的（見 tools/make-specs.mjs 的說明）。
// 所以這裡是 OR 不是 AND：他打「保護層 續接」時，索引裡不會有這兩個詞，
// 但只要有一個詞對上章名（例如「鋼筋」）就該告訴他去翻哪一章。

let specPromise = null;

export function loadSpecs() {
  if (!specPromise) {
    specPromise = fetch('data/specs.json')
      .then((r) => {
        if (!r.ok) throw new Error(`載不到規範索引（HTTP ${r.status}）`);
        return r.json();
      })
      .catch((err) => { specPromise = null; throw err; });
  }
  return specPromise;
}

export async function specInfo() {
  const p = await loadSpecs();
  return { title: p.title, source: p.source, license: p.license, listUrl: p.listUrl, fetchedAt: p.fetchedAt, count: p.chapters.length };
}

/** @returns {Promise<{hits: object[], words: string[]}>} */
export async function searchSpecs(q, { limit = 20 } = {}) {
  const words = parseQuery(q);
  if (!words.length) return { hits: [], words };
  const pack = await loadSpecs();

  const hits = [];
  for (const c of pack.chapters) {
    const hay = `${c.code} ${c.name}`;
    const matched = words.filter((w) => hay.includes(w));
    if (!matched.length) continue;
    // 對到的詞越多、章名越短，越可能就是那一章
    hits.push({ ...c, matched, score: matched.length * 100 - c.name.length });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits: hits.slice(0, limit), words };
}

function countOf(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

/** 20251219 → 2025-12-19 */
export function fmtLawDate(d) {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || '';
}
