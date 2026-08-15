// 進入點：hash router + 全域狀態列。

import { el, toast, setTitle, setBack, currentBack } from './ui.js';
import { getSetting, requestPersistence } from './db.js';
import { icon } from './icons.js';
import { initTaxonomy } from './taxonomy.js';

const view = document.getElementById('view');
const backBtn = document.getElementById('btn-back');

/** [pattern, loader]。pattern 用 :name 表示參數。 */
const ROUTES = [
  ['/', () => import('./views/projects.js')],
  ['/settings', () => import('./views/settings.js')],
  ['/lib', () => import('./views/library.js')],
  ['/laws', () => import('./views/laws.js')],
  ['/lib/:catId', () => import('./views/category.js')],
  ['/p/:projectId', () => import('./views/project.js')],
  ['/p/:projectId/edit', () => import('./views/project-edit.js')],
  ['/p/:projectId/day/:date', () => import('./views/day.js')],
  ['/p/:projectId/new', () => import('./views/entry.js')],
  ['/p/:projectId/report/:date', () => import('./views/report.js')],
  ['/p/:projectId/reports', () => import('./views/reports.js')],
  ['/e/:entryId', () => import('./views/entry.js')],
];

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pattern, loader] of ROUTES) {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { loader, params };
  }
  return null;
}

/**
 * 這個網址的「上一層」。純粹看網址算，跟使用者是怎麼走到這裡的無關——
 * 這正是重點：從哪來不影響返回會去哪，返回永遠不會掉進編輯或新增的頁面。
 *
 * 記錄頁（/e/:entryId）算不出來，要看那筆記錄屬於誰，由 entry.js 自己覆寫。
 */
function parentOf(path, query) {
  const s = path.split('/').filter(Boolean);

  if (s[0] === 'lib') return '#/lib'; // /lib/:catId
  if (s[0] === 'laws') return '#/lib'; // 查法規掛在工項分類那一側
  if (s[0] !== 'p') return '#/';

  const pid = s[1];
  if (pid === 'new' || s.length === 2) return '#/'; // 還沒建立的專案／專案首頁
  if (s[2] === 'day') return `#/p/${pid}`;
  if (s[2] === 'report') return `#/p/${pid}/day/${s[3]}`;
  // 新增記錄是從某一天點進來的，就回那一天
  if (s[2] === 'new' && query.get('date')) return `#/p/${pid}/day/${query.get('date')}`;
  return `#/p/${pid}`; // edit / reports / new
}

let renderToken = 0;

async function render() {
  const [rawPath, rawQuery] = (location.hash.slice(1) || '/').split('?');
  const path = rawPath || '/';
  const token = ++renderToken;
  const hit = match(path);

  backBtn.hidden = path === '/' || path === '/lib' || path === '/settings';
  // 先給依網址算出來的預設值，頁面自己有更好的答案時會在渲染時覆寫掉
  setBack(parentOf(path, new URLSearchParams(rawQuery || '')));
  syncTabs(path);

  if (!hit) {
    view.replaceChildren(el('div', { class: 'empty' }, [
      el('strong', { text: '找不到這個頁面' }),
      el('a', { href: '#/', class: 'btn', text: '回專案列表', style: 'margin-top:12px' }),
    ]));
    return;
  }

  view.replaceChildren(el('div', { class: 'loading', text: '載入中…' }));
  try {
    const mod = await hit.loader();
    if (token !== renderToken) return; // 使用者已經切走，丟棄這次結果
    const node = await mod.default(hit.params);
    if (token !== renderToken) return;
    view.replaceChildren(node);
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    view.replaceChildren(el('div', { class: 'empty' }, [
      el('strong', { text: '這一頁壞掉了' }),
      el('p', { class: 'muted', text: String(err?.message || err) }),
      el('a', { href: '#/', class: 'btn ghost', text: '回專案列表', style: 'margin-top:12px' }),
    ]));
  }
}

function syncTabs(path) {
  // 設定不在底部分頁裡，它是右上角那顆，所以在設定頁時兩個分頁都不亮
  const active = (path.startsWith('/lib') || path.startsWith('/laws')) ? 'lib'
    : path.startsWith('/settings') ? 'settings'
    : 'projects';
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.classList.toggle('active', a.dataset.tab === active);
  }
  document.getElementById('settings-btn').classList.toggle('active', active === 'settings');
}

backBtn.addEventListener('click', () => { location.hash = currentBack(); });

/**
 * 讓底部分頁列重新校正位置。
 *
 * iOS 的 PWA 在啟動的頭幾幀有時還沒把版面可視區的高度算完，
 * position:fixed 的分頁列就會錨在偏高的位置，底下露出一條空白，
 * 直到發生任何一次重排才跳回去——切一次分頁就會，所以看起來像「按一下才好」。
 *
 * 這裡不去猜是哪個值算錯，直接強制重排讓 WebKit 自己重新解析錨點。
 * display 在同一幀內關掉再打開，不會真的畫出來，所以不會閃。
 */
/**
 * 量一次目前的可視區數字。
 *
 * 分頁列在啟動時錨在偏高的位置，改了兩版都沒用，連「在分頁列底下墊同色背景」
 * 都沒效——那代表那條空白很可能根本不在網頁裡，而是 web view 本身比螢幕矮，
 * 露出底下 App 的背景。頁面內的 CSS 碰不到那塊。
 *
 * 與其再猜第四次，不如把啟動當下與第一次觸控之後的數字都留著，
 * 讓裝置自己講。顯示在設定頁最下面。
 */
function snapshotViewport() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;'
    + 'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const insetTop = cs.paddingTop;
  const insetBottom = cs.paddingBottom;
  probe.remove();

  const bar = document.getElementById('tabbar');
  return {
    innerHeight: window.innerHeight,
    screenHeight: window.screen?.height ?? 0,
    visualViewport: Math.round(window.visualViewport?.height ?? 0),
    insetTop,
    insetBottom,
    tabbarBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : null,
    dpr: window.devicePixelRatio,
    standalone: !!(window.navigator.standalone ?? matchMedia('(display-mode: standalone)').matches),
  };
}

export const viewportLog = { boot: null, afterTouch: null };

function settleTabbar() {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  // 動 bottom 而不是 display：display:none 會把元素抽出繪製樹，
  // 放回來時仍然沿用同一個錯的可視區（第一版就是這樣才沒效）。
  // 改成隔一幀把 bottom 挪回去，強迫它重新解析一次錨點。
  bar.style.bottom = '0.02px';
  requestAnimationFrame(() => { bar.style.bottom = ''; });
}

// 啟動動畫、鍵盤收起、從背景切回來都可能讓可視區變動，每一種都校正一次
for (const ev of ['pageshow', 'orientationchange', 'resize']) {
  window.addEventListener(ev, settleTabbar);
}
window.visualViewport?.addEventListener('resize', settleTabbar);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) settleTabbar();
});
// 真正讓 iOS 把可視區算對的，很可能就是第一次觸控本身。
// 那就在第一次觸控的當下也校正一次，不必等使用者剛好按到某個按鈕。
document.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
document.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true });

function onFirstTouch() {
  settleTabbar();
  // 觸控之後量一次，跟啟動當下的數字對照，就知道到底是什麼變了
  if (!viewportLog.afterTouch) {
    setTimeout(() => { viewportLog.afterTouch = snapshotViewport(); }, 250);
  }
}

/** 頂端的方案標示。付費層與免費層在保密上差很多，所以永遠顯示著。 */
export async function refreshTierBadge() {
  const badge = document.getElementById('tier-badge');
  const key = await getSetting('geminiApiKey', '');
  const tier = await getSetting('geminiTier', '');
  // 標籤要短——它跟齒輪擠在頂端同一顆按鈕裡，長字會把標題壓掉
  const btn = document.getElementById('settings-btn');
  if (!await getSetting('aiEnabled', true)) {
    badge.className = 'tier tier-off';
    badge.textContent = 'AI 關';
    btn.title = '設定（AI 已關閉）';
  } else if (!key) {
    badge.className = 'tier tier-off';
    badge.textContent = '未設定';
    btn.title = '設定（還沒設定 AI）';
  } else if (tier === 'paid') {
    badge.className = 'tier tier-paid';
    badge.textContent = '付費';
    btn.title = '設定（Gemini 付費層）';
  } else {
    badge.className = 'tier tier-free';
    badge.textContent = '免費';
    btn.title = '設定（Gemini 免費層，內容可能被 Google 用於改善產品）';
  }
}

window.addEventListener('hashchange', render);

window.addEventListener('error', (e) => {
  console.error('uncaught', e.error || e.message);
});

/** 外殼的 icon 也從 icons.js 來，才不會有兩份圖示定義各走各的。 */
function paintChromeIcons() {
  backBtn.replaceChildren(icon('chevronLeft', { size: 24 }));
  const tabIcons = { projects: 'building', lib: 'layers' };
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.querySelector('.ico')?.replaceChildren(icon(tabIcons[a.dataset.tab], { size: 22 }));
  }
  document.querySelector('#settings-btn .ico').replaceChildren(icon('sliders', { size: 20 }));
}

(async function boot() {
  setTitle('監造工地筆記');
  paintChromeIcons();
  await initTaxonomy(); // 自訂分類要在任何頁面渲染之前就位
  await refreshTierBadge();
  requestPersistence().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  }

  await render();

  // 開機後校正三次：畫完第一幀、啟動動畫大致結束、以及慢一點的機器。
  // 這是補償 iOS 的時序問題，成本是三次重排，看不出來也感覺不到。
  requestAnimationFrame(() => {
    settleTabbar();
    viewportLog.boot = snapshotViewport(); // 觸控之前的數字，這才是關鍵那一組
  });
  setTimeout(settleTabbar, 300);
  setTimeout(settleTabbar, 1200);
})().catch((err) => {
  console.error(err);
  view.replaceChildren(el('div', { class: 'empty' }, [
    el('strong', { text: '啟動失敗' }),
    el('p', { class: 'muted', text: String(err?.message || err) }),
  ]));
  toast('啟動失敗，請看主控台');
});
