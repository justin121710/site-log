// 產生法規包 data/laws.json。
//
// 為什麼可以整包放進來：著作權法第 9 條，法律、命令、公文書不得為著作權之標的。
// 全國法規資料庫（法務部）另有開放資料授權，非專屬、免費。
// **CNS 國家標準不在此列**（標準檢驗局有販售與授權限制），不要加進來。
// 公共工程施工綱要規範的授權還沒確認，也先不要加。
//
// 資料來自 kong0107/mojLawSplitJSON，那是把官方開放資料切成單一法規的鏡像。
// 要更新就重跑一次：node tools/make-laws.mjs
//
// 只收「監造實際會被問責」的法規。不是收得越多越好——
// 法規包越大，下載越久、搜尋雜訊越多，而他要的是查得到、查得準。

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://raw.githubusercontent.com/kong0107/mojLawSplitJSON/gh-pages';

const LAWS = [
  ['N0060001', '職業安全衛生法'],
  ['N0060002', '職業安全衛生法施行細則'],
  ['N0060014', '營造安全衛生設施標準'],
  // 動火、局限空間、電氣、機械防護的細則在設施規則，不在營造標準
  ['N0060009', '職業安全衛生設施規則'],
  ['N0060027', '職業安全衛生管理辦法'],
  ['N0060013', '起重升降機具安全規則'],
  // 箱涵、人孔、沉砂池進去之前要查的那一部
  ['N0060020', '缺氧症預防規則'],
  ['A0030057', '政府採購法'],
  ['A0030058', '政府採購法施行細則'],
  ['D0070110', '營造業法'],
  ['J0110001', '水利法'],
  ['J0110029', '河川管理辦法'],
];

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
};

const dataDate = (await (await get(`${BASE}/UpdateDate.txt`)).text()).trim();

const laws = [];
for (const [pcode, expected] of LAWS) {
  const j = await (await get(`${BASE}/FalVMingLing/${pcode}.json`)).json();
  const name = j['法規名稱'];
  if (name !== expected) throw new Error(`${pcode} 抓到的是「${name}」，不是「${expected}」`);
  if (j['廢止註記']) throw new Error(`${name} 已廢止，不要收`);

  // 編章節是分隔用的，把它記在後續條文上，查到條文時才知道它屬於哪一章
  let chapter = '';
  const articles = [];
  for (const row of j['法規內容'] || []) {
    if (row['編章節']) { chapter = row['編章節'].replace(/\s+/g, ' ').trim(); continue; }
    const no = (row['條號'] || '').replace(/\s+/g, ' ').trim();
    const text = (row['條文內容'] || '').replace(/\r\n/g, '\n').trim();
    if (!no || !text) continue;
    articles.push(chapter ? { no, text, ch: chapter } : { no, text });
  }
  if (!articles.length) throw new Error(`${name} 一條都沒抓到`);

  laws.push({
    pcode,
    name,
    category: j['法規類別'] || '',
    updated: j['最新異動日期'] || '',
    url: `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=${pcode}`,
    articles,
  });
  console.log(`${name}　${articles.length} 條　異動 ${j['最新異動日期']}`);
}

const pack = {
  source: '全國法規資料庫（法務部）開放資料',
  note: '法律與命令依著作權法第 9 條不得為著作權之標的。本包不含 CNS 國家標準與施工綱要規範。',
  dataDate,
  builtAt: new Date().toISOString().slice(0, 10),
  laws,
};

const out = path.join(import.meta.dirname, '..', 'data', 'laws.json');
await fs.mkdir(path.dirname(out), { recursive: true });

// 條文沒變就不要重寫。builtAt 每次都不一樣，照寫的話排程會每個月產生一次
// 假變動，害所有裝置白白重抓 700KB。
const meaningful = JSON.stringify({ dataDate: pack.dataDate, laws: pack.laws });
const before = await fs.readFile(out, 'utf8').catch(() => '');
if (before) {
  const old = JSON.parse(before);
  if (JSON.stringify({ dataDate: old.dataDate, laws: old.laws }) === meaningful) {
    console.log('條文與上次完全相同，不重寫檔案');
    process.exit(0);
  }
}

await fs.writeFile(out, JSON.stringify(pack));
const { size } = await fs.stat(out);
console.log(`\n共 ${laws.length} 部、${laws.reduce((n, l) => n + l.articles.length, 0)} 條`);
console.log(`資料日期 ${dataDate}　→ data/laws.json ${(size / 1024).toFixed(0)} KB`);
