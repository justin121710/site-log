// 14 項固定一級分類。一級不可新增/刪除，子項由使用者自訂（存在 settings.subtags）。
// 排序大致依施工順序，方便在工地由上往下找。

export const CATEGORIES = [
  {
    id: 'temp',
    name: '假設工程與工區',
    icon: '🚧',
    seedSubtags: ['圍籬', '施工便道', '塔吊', '安衛設施', '臨時水電'],
  },
  {
    id: 'survey',
    name: '測量與放樣',
    icon: '📐',
    seedSubtags: ['基準點', '軸線放樣', '高程', '沉陷觀測'],
  },
  {
    id: 'foundation',
    name: '地質與基礎',
    icon: '⛏️',
    seedSubtags: ['開挖', '擋土壁', '支撐', '基樁', '地錨', '地下水位'],
  },
  {
    id: 'rebar',
    name: '鋼筋',
    icon: '🧱',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '續接位置', '續接方式', '主筋間距', '保護層', '彎鉤',
      '柱箍筋', '繫筋', '樑柱接頭', '版筋', '牆筋', '補強筋', '墊塊',
    ],
  },
  {
    id: 'formwork',
    name: '模板',
    icon: '🪵',
    seedSubtags: ['組立', '支撐架', '拆模時機', '清水模', '脫模劑', '垂直度'],
  },
  {
    id: 'concrete',
    name: '混凝土',
    icon: '🧴',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '配比設計', '坍度試驗', '氯離子檢測', '澆置', '搗實',
      '養護', '試體製作', '施工縫', '泌水', '蜂窩',
    ],
  },
  {
    id: 'steel',
    name: '鋼構',
    icon: '🏗️',
    // 使用者點名要細做的三項之一
    seedSubtags: [
      '吊裝', '高強度螺栓數量', '螺栓扭力', '銲道外觀', '銲道檢測',
      '防火被覆', '柱腳', '續接板', '垂直度校正',
    ],
  },
  {
    id: 'facade',
    name: '帷幕與外牆',
    icon: '🪟',
    seedSubtags: ['乾式施工', '濕式施工', '防水試驗', '嵌縫', '扣件'],
  },
  {
    id: 'waterproof',
    name: '防水與排水',
    icon: '💧',
    seedSubtags: ['屋頂', '浴廁', '地下外牆', '洩水坡', '試水'],
  },
  {
    id: 'mep',
    name: '機電與管線',
    icon: '🔌',
    seedSubtags: ['預埋管', '套管', '開口補強', '接地', '管線碰撞'],
  },
  {
    id: 'finish',
    name: '裝修',
    icon: '🎨',
    seedSubtags: ['輕隔間', '天花', '地坪', '門窗', '塗裝'],
  },
  {
    id: 'material',
    name: '材料進場與檢驗',
    icon: '📦',
    seedSubtags: ['材料送審', '進場檢查', '抽樣', '無破壞檢測', '出廠證明'],
  },
  {
    id: 'safety',
    name: '安全衛生',
    icon: '🦺',
    seedSubtags: ['護欄', '開口防護', '動火作業', '局限空間', '吊掛作業', '個人防護具'],
  },
  {
    id: 'defect',
    name: '品質異常與缺失改正',
    icon: '⚠️',
    seedSubtags: ['缺失單', '改正前', '改正後', '複驗', '不符合事項'],
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export function categoryName(id) {
  return CATEGORY_BY_ID[id]?.name ?? id;
}

export function categoryIcon(id) {
  return CATEGORY_BY_ID[id]?.icon ?? '📁';
}

/** 給 AI 用的分類清單，只給 id 與名稱，避免它自己發明分類。 */
export function taxonomyForPrompt() {
  return CATEGORIES.map((c) => `${c.id} = ${c.name}`).join('\n');
}

/** 初始子項表：{ categoryId: [subtag, ...] }，之後使用者可增刪，存在 settings。 */
export function seedSubtags() {
  return Object.fromEntries(CATEGORIES.map((c) => [c.id, [...c.seedSubtags]]));
}
