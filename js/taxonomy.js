// 14 項固定一級分類。一級不可新增/刪除，子項由使用者自訂（存在 settings.subtags）。
// 排序大致依施工順序，方便在工地由上往下找。
//
// icon 是 js/icons.js 裡的 SVG 名稱，不是 emoji。

export const CATEGORIES = [
  {
    id: 'temp',
    name: '假設工程與工區',
    icon: 'fence',
    seedSubtags: ['圍籬', '施工便道', '塔吊', '安衛設施', '臨時水電'],
  },
  {
    id: 'survey',
    name: '測量與放樣',
    icon: 'tripod',
    seedSubtags: ['基準點', '軸線放樣', '高程', '沉陷觀測'],
  },
  {
    id: 'foundation',
    name: '地質與基礎',
    icon: 'pile',
    seedSubtags: ['開挖', '擋土壁', '支撐', '基樁', '地錨', '地下水位'],
  },
  {
    id: 'rebar',
    name: '鋼筋',
    icon: 'rebar',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '續接位置', '續接方式', '主筋間距', '保護層', '彎鉤',
      '柱箍筋', '繫筋', '樑柱接頭', '版筋', '牆筋', '補強筋', '墊塊',
    ],
  },
  {
    id: 'formwork',
    name: '模板',
    icon: 'formwork',
    seedSubtags: ['組立', '支撐架', '拆模時機', '清水模', '脫模劑', '垂直度'],
  },
  {
    id: 'concrete',
    name: '混凝土',
    icon: 'slump',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '配比設計', '坍度試驗', '氯離子檢測', '澆置', '搗實',
      '養護', '試體製作', '施工縫', '泌水', '蜂窩',
    ],
  },
  {
    id: 'steel',
    name: '鋼構',
    icon: 'ibeam',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '吊裝', '高強度螺栓數量', '螺栓扭力', '銲道外觀', '銲道檢測',
      '防火被覆', '柱腳', '續接板', '垂直度校正',
    ],
  },
  {
    id: 'facade',
    name: '帷幕與外牆',
    icon: 'facade',
    seedSubtags: ['乾式施工', '濕式施工', '防水試驗', '嵌縫', '扣件'],
  },
  {
    id: 'waterproof',
    name: '防水與排水',
    icon: 'droplet',
    seedSubtags: ['屋頂', '浴廁', '地下外牆', '洩水坡', '試水'],
  },
  {
    id: 'mep',
    name: '機電與管線',
    icon: 'pipe',
    seedSubtags: ['預埋管', '套管', '開口補強', '接地', '管線碰撞'],
  },
  {
    id: 'finish',
    name: '裝修',
    icon: 'roller',
    seedSubtags: ['輕隔間', '天花', '地坪', '門窗', '塗裝'],
  },
  {
    id: 'material',
    name: '材料進場與檢驗',
    icon: 'crate',
    seedSubtags: ['材料送審', '進場檢查', '抽樣', '無破壞檢測', '出廠證明'],
  },
  {
    id: 'safety',
    name: '安全衛生',
    icon: 'hardhat',
    seedSubtags: ['護欄', '開口防護', '動火作業', '局限空間', '吊掛作業', '個人防護具'],
  },
  {
    id: 'defect',
    name: '品質異常與缺失改正',
    icon: 'warning',
    seedSubtags: ['缺失單', '改正前', '改正後', '複驗', '不符合事項'],
  },
];

/** 內建那 14 項不能刪，刪掉會讓已經記過的東西變成孤兒。 */
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

// ---------- 自訂分類 ----------

/** 開機時呼叫一次。把使用者自訂的一級分類接在內建 14 項後面。 */
export async function initTaxonomy() {
  const { getSetting } = await import('./db.js');
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
  if (!isCustomCategory(id)) throw new Error('內建的 14 項分類不能刪');

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
