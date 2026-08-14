// 產生施工綱要規範的章節索引 data/specs.json。
//
// 為什麼只做索引不放全文：使用者選的。索引回答「這件事在哪一本的哪一章」，
// 全文則有版本對應的風險——他案子適用的是招標當時那一版，而且主辦機關通常
// 還會在通用版上增修，那份增修版才是他要查驗的依據。
//
// 授權：工程會網站的「政府網站資料開放宣告」寫明所有資料與素材採
// 「政府資料開放授權條款－第 1 版」，得無償重製、改作、編輯、公開傳輸，
// 使用時應註明出處。所以索引（甚至全文）都可以收，但**要註明出處**。
//
// 資料來自該站查詢頁自己在打的 API。要更新就重跑：node tools/make-specs.mjs
// 跑完記得 bump sw.js 的 CACHE，不然裝置上會一直用舊的那份。

import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://pcic.pcc.gov.tw/pwc-web/api/service/tec-fundamental-codes/getSearchList';
const REFERER = 'https://pcic.pcc.gov.tw/pwc-web/service/tec0304';
// 分頁參數在 POST body 裡，不是 query string——query string 給了會被無視，
// 每一頁都回同一批。currentPage 是 0 起算，perPage 吃得下大數字。
async function fetchPage(currentPage, perPage) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Referer: REFERER },
        body: JSON.stringify({ tecCode: '', cname: '', currentPage, perPage, sortBy: [], sortDirection: 'ASC' }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  // 這個站連不上境外 IP（GitHub Actions 的機器在美國），排程跑到這裡會失敗。
  // 那不是壞掉，是這一份只能從台灣的網路更新——見 .github/workflows/update-data.yml。
  throw new Error(`第 ${currentPage} 頁抓不到：${lastErr?.message || lastErr}`);
}

const probe = await fetchPage(0, 1);
const total = probe.totalElements;
const all = await fetchPage(0, total + 50);
const rows = all.content || [];
console.log(`網站說 ${total} 章，取回 ${rows.length} 筆`);

const chapters = rows
  .map((r) => ({
    code: String(r.sample || '').trim(),
    name: String(r.cname || '').trim(),
    // fEdition 是「完整版」的版次；已刪除的章節這裡會是空的
    ver: r.fEdition ? `V${r.fEdition}` : '',
  }))
  .filter((c) => /^\d{5}$/.test(c.code) && c.name)
  .sort((a, b) => a.code.localeCompare(b.code));

// 這支 API 的分頁是 1-based，page=0 與 page=1 會拿到同一批，所以一定要去重
const byCode = new Map();
for (const c of chapters) if (!byCode.has(c.code)) byCode.set(c.code, c);
const unique = [...byCode.values()];
if (unique.length !== total) {
  throw new Error(`網站說 ${total} 章，去重後只有 ${unique.length} 章——抓漏了就不要產出`);
}

const pack = {
  title: '公共工程共通性工項施工綱要規範',
  source: '行政院公共工程委員會　公共工程雲端服務網',
  license: '政府資料開放授權條款－第 1 版',
  listUrl: REFERER,
  fetchedAt: new Date().toISOString().slice(0, 10),
  chapters: unique,
};

const out = path.join(import.meta.dirname, '..', 'data', 'specs.json');
await fs.mkdir(path.dirname(out), { recursive: true });

// 章節沒變就不要重寫，理由同 make-laws.mjs：fetchedAt 每次都不一樣
const meaningful = JSON.stringify(pack.chapters);
const before = await fs.readFile(out, 'utf8').catch(() => '');
if (before && JSON.stringify(JSON.parse(before).chapters) === meaningful) {
  console.log('章節與上次完全相同，不重寫檔案');
  process.exit(0);
}

await fs.writeFile(out, JSON.stringify(pack));
const { size } = await fs.stat(out);

const divisions = {};
for (const c of unique) divisions[c.code.slice(0, 2)] = (divisions[c.code.slice(0, 2)] || 0) + 1;
console.log(`共 ${unique.length} 章，分佈：`, divisions);
console.log(`→ data/specs.json ${(size / 1024).toFixed(0)} KB`);
