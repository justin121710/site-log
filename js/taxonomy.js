// 一級分類。內建這些不可新增/刪除，子項由使用者自訂（存在 settings.subtags）。
// 排序大致依施工順序，方便在工地由上往下找。
//
// icon 是 js/icons.js 裡的 SVG 名稱，不是 emoji。
//
// 這份清單是為「橋梁與水利結構為主、偶爾建築房舍」的監造工作設計的。
// 子項刻意寫成監造會實際去查驗的動作或部位，而不是工程名詞——
// 「施拉記錄」「膜厚檢測」比「預力」「塗裝」更接近你在現場真正會記的東西。

export const CATEGORIES = [
  {
    id: 'temp',
    name: '假設工程與工區',
    icon: 'fence',
    seedSubtags: [
      '圍堰', '導流', '臨時擋水', '抽排水', '施工便道', '施工便橋',
      '施工平台', '工區圍籬', '臨時水電',
    ],
  },
  {
    id: 'survey',
    name: '測量與放樣',
    icon: 'tripod',
    seedSubtags: [
      '基準點', '中心樁', '橋梁中心線', '墩柱垂直度', '高程',
      '斷面測量', '沉陷觀測', '變位監測',
    ],
  },
  {
    id: 'foundation',
    name: '地質與基礎',
    icon: 'pile',
    seedSubtags: [
      '場鑄樁', '預鑄樁', '基樁載重試驗', '樁身完整性試驗', '沉箱',
      '基礎開挖', '擋土支撐', '地錨', '地下水位', '基礎混凝土',
    ],
  },
  {
    id: 'rebar',
    name: '鋼筋',
    icon: 'rebar',
    seedSubtags: [
      '續接位置', '續接方式', '主筋間距', '保護層', '彎鉤',
      '箍筋', '繫筋', '墩柱鋼筋', '版筋', '牆筋', '補強筋', '墊塊',
    ],
  },
  {
    id: 'formwork',
    name: '模板與支撐',
    icon: 'formwork',
    seedSubtags: [
      '模板組立', '支撐架', '支撐架驗算', '支撐先進工法',
      '拆模時機', '清水模', '脫模劑', '垂直度', '預拱',
    ],
  },
  {
    id: 'concrete',
    name: '混凝土',
    icon: 'slump',
    seedSubtags: [
      '配比設計', '坍度試驗', '氯離子檢測', '澆置', '搗實', '養護',
      '試體製作', '施工縫', '大體積混凝土', '水化熱溫控', '泌水', '蜂窩', '裂縫',
    ],
  },
  {
    id: 'prestress',
    name: '預力工程',
    icon: 'tendon',
    // 施拉記錄的伸長量與油壓對不上是要停工的事，值得自己一個分類
    seedSubtags: [
      '套管定位', '鋼腱檢驗', '施拉前強度', '施拉記錄', '伸長量核對',
      '油壓對照', '預力損失', '灌漿配比', '灌漿飽滿度',
      '錨定區', '錨頭保護', '先拉法', '後拉法',
    ],
  },
  {
    id: 'steel',
    name: '鋼構與銲接',
    icon: 'ibeam',
    seedSubtags: [
      '吊裝', '假組立', '高強度螺栓數量', '螺栓扭力', '銲道外觀',
      '銲道非破壞檢測', '續接板', '垂直度校正', '支承墊板',
    ],
  },
  {
    id: 'bridge',
    name: '橋梁上部結構',
    icon: 'bridge',
    seedSubtags: [
      '支承', '支承墊', '伸縮縫', '預鑄梁吊裝', '節塊接合',
      '橋面版', '橋面鋪面', '防落橋設施', '橋梁排水', '護欄欄杆', '施工載重',
    ],
  },
  {
    id: 'hydraulic',
    name: '河防與水利構造',
    icon: 'gate',
    seedSubtags: [
      '護岸', '堤防', '疏濬', '拋石', '蛇籠', '地工織物', '消能工',
      '水門', '閘門門葉', '啟閉機', '溢洪道', '抽水站', '水密試驗', '通水斷面',
    ],
  },
  {
    id: 'culvert',
    name: '匯排水與管渠',
    icon: 'culvert',
    seedSubtags: [
      '箱涵', '箱涵接頭', '推管工法', '開挖埋管', '管基',
      '人孔', '沉砂池', '洩水坡度', '回填夯實', '管線試水',
    ],
  },
  {
    id: 'coating',
    name: '防蝕與塗裝',
    icon: 'roller',
    seedSubtags: [
      '表面處理', '噴砂', '底漆', '中塗', '面漆', '膜厚檢測',
      '附著力試驗', '熱浸鍍鋅', '陰極防蝕', '塗裝環境條件',
    ],
  },
  {
    id: 'waterproof',
    name: '防水與止水',
    icon: 'droplet',
    seedSubtags: [
      '橋面防水層', '止水帶', '施工縫止水', '伸縮縫防水',
      '防水膜', '試水', '滲漏',
    ],
  },
  {
    id: 'building',
    name: '建築裝修與機電',
    icon: 'facade',
    // 偶爾接到房舍工程時才會用到，所以三類併成一項，不佔太多版面
    seedSubtags: [
      '隔間牆', '天花', '地坪', '門窗', '塗裝',
      '預埋管', '套管', '開口補強', '接地', '給排水',
    ],
  },
  {
    id: 'material',
    name: '材料進場與檢驗',
    icon: 'crate',
    seedSubtags: [
      '材料送審', '進場檢查', '抽樣', '出廠證明',
      '無破壞檢測', '試驗報告', '不合格品處理',
    ],
  },
  {
    id: 'safety',
    name: '安全衛生',
    icon: 'hardhat',
    seedSubtags: [
      '護欄', '開口防護', '臨水作業', '圍堰內作業', '動火作業',
      '局限空間', '吊掛作業', '個人防護具', '交維',
    ],
  },
  {
    id: 'defect',
    name: '品質異常與缺失改正',
    icon: 'warning',
    seedSubtags: [
      '缺失單', '改正前', '改正後', '複驗',
      '不符合事項', '監造通知', '停工處理',
    ],
  },
];

/** 內建這些不能刪，刪掉會讓已經記過的東西變成孤兒。 */
export const BUILTIN_IDS = new Set(CATEGORIES.map((c) => c.id));

// CATEGORIES 是「內建 + 使用者自訂」的合併結果，開機時由 initTaxonomy() 就地補上自訂項。
// 用就地修改而不是重新指派，是為了讓各個 view 直接 import 這個陣列就好，不必到處傳來傳去。

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

export function categoryName(id) {
  return categoryById(id)?.name ?? id;
}

/** 回傳 js/icons.js 的 icon 名稱。 */
export function categoryIcon(id) {
  return categoryById(id)?.icon ?? 'note';
}

export function isCustomCategory(id) {
  return !BUILTIN_IDS.has(id);
}

/** 給 AI 用的分類清單，只給 id 與名稱，避免它自己發明分類。 */
export function taxonomyForPrompt() {
  return CATEGORIES.map((c) => `${c.id} = ${c.name}`).join('\n');
}

/** 初始子項表：{ categoryId: [subtag, ...] }，之後使用者可增刪，存在 settings。 */
export function seedSubtags() {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, [...c.seedSubtags]]));
}

// ---------- 舊分類的遷移 ----------

/**
 * v1 是建築導向的分類，v2 改成橋梁水利導向。這裡把被拿掉的 id 接到新的去，
 * 不然舊記錄會掛著一個查不到名字、也不會出現在經驗庫裡的孤兒 id。
 */
const LEGACY_MAP = {
  facade: 'building', // 帷幕與外牆 → 建築裝修與機電
  finish: 'building', // 裝修 → 建築裝修與機電
  mep: 'building',    // 機電與管線 → 建築裝修與機電
};

async function migrateLegacyCategories() {
  const db = await import('./db.js');
  if (await db.getSetting('taxonomyVersion', 1) >= 2) return 0;

  const entries = await db.getAll('entries');
  let touched = 0;
  for (const e of entries) {
    if (!e.categoryIds?.some((c) => LEGACY_MAP[c])) continue;
    e.categoryIds = [...new Set(e.categoryIds.map((c) => LEGACY_MAP[c] || c))];
    await db.saveEntry(e);
    touched++;
  }

  // 子項表也要跟著搬，不然舊子項會留在一個不存在的分類底下
  const subtags = await db.getSetting('subtags', null);
  if (subtags) {
    for (const [oldId, newId] of Object.entries(LEGACY_MAP)) {
      if (!subtags[oldId]) continue;
      subtags[newId] = [...new Set([...(subtags[newId] || []), ...subtags[oldId]])];
      delete subtags[oldId];
    }
    await db.setSetting('subtags', subtags);
  }

  await db.setSetting('taxonomyVersion', 2);
  return touched;
}

// ---------- 自訂分類 ----------

/** 開機時呼叫一次。先做舊分類遷移，再把使用者自訂的一級分類接在內建後面。 */
export async function initTaxonomy() {
  const { getSetting } = await import('./db.js');
  await migrateLegacyCategories();

  const custom = await getSetting('customCategories', []);
  CATEGORIES.length = BUILTIN_IDS.size; // 重載時先砍掉舊的自訂項，避免重複
  for (const c of custom) {
    CATEGORIES.push({ seedSubtags: [], ...c });
  }
  return CATEGORIES;
}

async function persistCustom() {
  const { setSetting } = await import('./db.js');
  const custom = CATEGORIES.filter((c) => isCustomCategory(c.id))
    .map(({ id, name, icon }) => ({ id, name, icon }));
  await setSetting('customCategories', custom);
}

/** @returns {{id: string, name: string, icon: string}} 新增的分類 */
export async function addCategory({ name, icon = 'note' }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分類名稱不能空白');
  if (CATEGORIES.some((c) => c.name === trimmed)) throw new Error(`已經有一個叫「${trimmed}」的分類了`);

  const { uid } = await import('./db.js');
  const cat = { id: uid('cat_'), name: trimmed, icon, seedSubtags: [] };
  CATEGORIES.push(cat);
  await persistCustom();
  return cat;
}

export async function renameCategory(id, name) {
  const cat = categoryById(id);
  if (!cat || !isCustomCategory(id)) throw new Error('內建分類不能改名');
  cat.name = name.trim() || cat.name;
  await persistCustom();
  return cat;
}

/**
 * 刪掉一個自訂分類，並把所有記錄上的這個標記一起拿掉，
 * 不然那些記錄會掛著一個查不到名字的分類 id。
 * @returns {number} 受影響的記錄筆數
 */
export async function removeCategory(id) {
  if (!isCustomCategory(id)) throw new Error('內建分類不能刪');

  const db = await import('./db.js');
  const affected = await db.listEntriesByCategory(id);
  for (const e of affected) {
    e.categoryIds = e.categoryIds.filter((c) => c !== id);
    await db.saveEntry(e);
  }

  const i = CATEGORIES.findIndex((c) => c.id === id);
  if (i >= 0) CATEGORIES.splice(i, 1);

  const subtags = await db.getSetting('subtags', null);
  if (subtags && subtags[id]) {
    delete subtags[id];
    await db.setSetting('subtags', subtags);
  }

  await persistCustom();
  return affected.length;
}
