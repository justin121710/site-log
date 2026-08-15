// SVG icon set。取代原本的 emoji。
//
// 為什麼不用 emoji：不同 iOS / Android 版本畫出來的長相不一樣，尺寸對不齊，
// 而且顏色是寫死的，沒辦法跟著主題或「選中」狀態變。這裡全部用 currentColor 描邊，
// 放在哪個顏色的容器裡就是什麼顏色。
//
// 全部 24×24 viewBox，線條式，stroke 用 currentColor。少數需要實心的（sparkle）另外標記。

const SVG_NS = 'http://www.w3.org/2000/svg';

/** @type {Record<string, { d: string, filled?: boolean }>} */
const SHAPES = {
  // ---------- 14 項工項分類 ----------

  // 假設工程與工區：工區拒馬（斜紋警示板 + 兩支腳）
  fence: { d: '<path d="M3 7.5h18v4H3z"/><path d="M8 7.5 5.5 11.5M13 7.5l-2.5 4M18 7.5l-2.5 4"/><path d="M7 11.5 5 20.5M17 11.5l2 9"/><path d="M6.3 16.5h11.4"/>' },
  // 測量與放樣：經緯儀三腳架
  tripod: { d: '<circle cx="12" cy="6.5" r="3"/><path d="M12 3.5v6M9 6.5h6"/><path d="M12 9.5 7 20M12 9.5 17 20M12 9.5V20"/>' },
  // 地質與基礎：打入地盤的樁（地表線 + 地盤斜紋）
  pile: { d: '<path d="M2 7.5h20"/><path d="M4.5 7.5 3 10.5M8 7.5 6.5 10.5M17.5 7.5 16 10.5M21 7.5l-1.5 3"/><path d="M10 7.5v10.2M14 7.5v10.2"/><path d="m10 17.7 2 2.8 2-2.8"/>' },
  // 鋼筋：鋼筋網
  rebar: { d: '<path d="M4 8.5h16M4 12h16M4 15.5h16M8.5 4v16M12 4v16M15.5 4v16"/>' },
  // 模板：立好的模板 + 兩支斜撐落到地面
  formwork: { d: '<path d="M4.5 3.5h5v15h-5z"/><path d="M3 18.5h18"/><path d="M9.5 6.5 18 18.5M9.5 12l4.5 6.5"/>' },
  // 混凝土：坍度錐
  slump: { d: '<path d="M9 4h6l3.5 16h-13z"/><path d="M9 4h6"/><path d="M7 20h10"/>' },
  // 鋼構：I 型鋼斷面
  ibeam: { d: '<path d="M5 4h14M5 20h14M12 4v16"/>' },
  // 帷幕與外牆：立面格窗
  facade: { d: '<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 9.5h16M4 15h16M12 3.5v17"/>' },
  // 防水與排水：水滴與水面
  droplet: { d: '<path d="M12 3c3 3.7 4.6 6.2 4.6 8.2a4.6 4.6 0 1 1-9.2 0C7.4 9.2 9 6.7 12 3z"/><path d="M3 19.5c1.9-1.4 3.4-1.4 5.3 0s3.4 1.4 5.4 0 3.4-1.4 5.3 0"/>' },
  // 機電與管線：彎頭管線（雙線管身 + 兩端法蘭）
  pipe: {
    d: '<path d="M4 4.5h5.5A10 10 0 0 1 19.5 14.5V20"/>'
      + '<path d="M4 9.5h5.5a5 5 0 0 1 5 5V20"/>'
      + '<path d="M4 3v8M13 20.5h8"/>',
  },
  // 裝修：滾筒刷（滾筒 + 繞回中線的把手 + 握柄）
  roller: {
    d: '<rect x="3" y="3.5" width="12" height="6" rx="1.6"/>'
      + '<path d="M15 6.5h2.4A1.6 1.6 0 0 1 19 8.1v2.8a1.6 1.6 0 0 1-1.6 1.6H12v2.2"/>'
      + '<rect x="9.6" y="14.7" width="4.8" height="6.3" rx="1.6"/>',
  },
  // 材料進場與檢驗：料件箱
  crate: { d: '<path d="m12 3-9 4v10l9 4 9-4V7z"/><path d="m3 7 9 4 9-4M12 11v10"/>' },
  // 安全衛生：安全帽（圓頂 + 帽簷 + 頂部氣槽）
  hardhat: {
    d: '<path d="M5 17c0-4.4 3.1-8 7-8s7 3.6 7 8"/>'
      + '<path d="M2.5 17h19"/>'
      + '<path d="M9.6 9.6V7.2h4.8v2.4"/>',
  },
  // 品質異常與缺失改正：警示
  warning: { d: '<path d="M12 3.5 22 20.5H2z"/><path d="M12 10v4.6"/><circle cx="12" cy="17.6" r=".6" fill="currentColor" stroke="none"/>' },

  // 預力工程：兩端錨錠板 + 下垂的鋼腱 + 向外的施拉方向
  // 刻意不畫成拱形，不然在小尺寸會跟 bridge 混在一起
  tendon: {
    d: '<path d="M5.5 5v14M18.5 5v14"/><path d="M5.5 9.5c4.3 7 8.7 7 13 0"/>'
      + '<path d="M4 12H1.8M3 10.6 1.6 12 3 13.4"/><path d="M20 12h2.2M21 10.6 22.4 12 21 13.4"/>',
  },
  // 橋梁上部結構：橋面版 + 橋墩 + 水面
  bridge: {
    d: '<path d="M2 10h20"/><path d="M7 10v7M17 10v7"/><path d="M4.5 7.5V10M12 7.5V10M19.5 7.5V10"/>'
      + '<path d="M2 20.5c2-1.3 3-1.3 5 0s3 1.3 5 0 3-1.3 5 0 3 1.3 5 0"/>',
  },
  // 河防與水利構造：導槽 + 閘門門葉 + 上方的啟閉機
  // 不畫水波，水波留給 bridge，兩個都畫會在小尺寸糊成同一個東西
  gate: {
    d: '<circle cx="12" cy="3.4" r="1.5"/><path d="M12 4.9v2.6"/>'
      + '<path d="M4.5 5v15M19.5 5v15"/><path d="M4.5 7.5h15v5.5h-15z"/><path d="M2.5 20h19"/>',
  },
  // 匯排水與管渠：箱涵斷面 + 通水流向
  culvert: {
    d: '<path d="M2.5 5.5h19v13h-19z"/><path d="M6.5 9h11v6h-11z"/>'
      + '<path d="M8.6 12h6.6M13.2 9.9 15.4 12l-2.2 2.1"/>',
  },

  // ---------- 導覽 ----------

  building: { d: '<path d="M3 21h18"/><path d="M5 21V8.5L12 4l7 4.5V21"/><path d="M9.5 21v-5h5v5"/><path d="M9.5 11.5h1M13.5 11.5h1"/>' },
  layers: { d: '<path d="m12 2.5 9.5 5.2-9.5 5.2L2.5 7.7z"/><path d="m2.5 13 9.5 5.2 9.5-5.2"/>' },
  sliders: { d: '<path d="M4 7h9M18.5 7H20M4 12h3.5M13 12h7M4 17h11M20.5 17H20"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="17.5" cy="17" r="2.2"/>' },

  // ---------- 動作 ----------

  camera: { d: '<path d="M3 8.5a2 2 0 0 1 2-2h2.3l1.4-2h6.6l1.4 2H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.6"/>' },
  image: { d: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m3.5 17 4.8-4.8 3.7 3.7 3-3 5.5 5.5"/>' },
  mic: { d: '<path d="M12 3.2a2.9 2.9 0 0 1 2.9 2.9v5.8a2.9 2.9 0 0 1-5.8 0V6.1A2.9 2.9 0 0 1 12 3.2z"/><path d="M5.5 11.3a6.5 6.5 0 0 0 13 0"/><path d="M12 17.8V21M8.8 21h6.4"/>' },
  stop: { d: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>' },
  importFile: { d: '<path d="M12 3.5v9.5"/><path d="m8.2 9.3 3.8 3.7 3.8-3.7"/><path d="M4 15.5V18a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 18v-2.5"/>' },
  sparkle: {
    filled: true,
    d: '<path d="M10.5 5.5c.85 4.35 2.15 5.65 6.5 6.5-4.35.85-5.65 2.15-6.5 6.5-.85-4.35-2.15-5.65-6.5-6.5 4.35-.85 5.65-2.15 6.5-6.5z"/>'
      + '<path d="M18.6 3c.32 1.6.78 2.06 2.4 2.4-1.62.34-2.08.8-2.4 2.4-.32-1.6-.78-2.06-2.4-2.4 1.62-.34 2.08-.8 2.4-2.4z"/>',
  },
  note: { d: '<path d="M6 3.5h7.5L18 8v12.5H6z"/><path d="M13.5 3.5V8H18"/><path d="M9 12.5h6M9 16h6"/>' },
  waveform: { d: '<path d="M3.5 10.5v3M7.5 6.5v11M11.5 3.5v17M15.5 8v8M19.5 10.5v3"/>' },
  book: { d: '<path d="M4 4.5h6a2.5 2.5 0 0 1 2 2 2.5 2.5 0 0 1 2-2h6v13h-6a2.5 2.5 0 0 0-2 2 2.5 2.5 0 0 0-2-2H4z"/><path d="M12 6.5v13"/>' },
  search: { d: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>' },
  plus: { d: '<path d="M12 5v14M5 12h14"/>' },
  close: { d: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>' },
  chevronLeft: { d: '<path d="m14.5 5-7 7 7 7"/>' },
};

/**
 * 建立一個 SVG icon 節點。
 * @param {keyof SHAPES} name
 * @param {{ size?: number, class?: string }} opts
 * @returns {SVGSVGElement}
 */
export function icon(name, opts = {}) {
  const shape = SHAPES[name] || SHAPES.note;
  const size = opts.size ?? 20;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${opts.class || ''}`.trim());

  if (shape.filled) {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }

  svg.innerHTML = shape.d;
  return svg;
}

export function hasIcon(name) {
  return Object.hasOwn(SHAPES, name);
}

/** 新增自訂分類時可以挑的圖示。動作類的（拍照、錄音…）不放進來，語意會打架。 */
export const PICKABLE_ICONS = [
  'note', 'fence', 'tripod', 'pile', 'rebar', 'formwork', 'slump', 'ibeam',
  'tendon', 'bridge', 'gate', 'culvert', 'facade', 'droplet', 'pipe', 'roller',
  'crate', 'hardhat', 'warning', 'building', 'layers', 'waveform', 'image', 'sliders',
];
