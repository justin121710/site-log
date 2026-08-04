// 進入點：hash router + 全域狀態列。

import { el, toast, setTitle } from './ui.js';
import { getSetting, requestPersistence } from './db.js';
import { icon } from './icons.js';

const view = document.getElementById('view');
const backBtn = document.getElementById('btn-back');

/** [pattern, loader]。pattern 用 :name 表示參數。 */
const ROUTES = [
  ['/', () => import('./views/projects.js')],
  ['/settings', () => import('./views/settings.js')],
  ['/lib', () => import('./views/library.js')],
  ['/lib/:catId', () => import('./views/category.js')],
  ['/p/:projectId', () => import('./views/project.js')],
  ['/p/:projectId/edit', () => import('./views/project-edit.js')],
  ['/p/:projectId/day/:date', () => import('./views/day.js')],
  ['/p/:projectId/new', () => import('./views/entry.js')],
  ['/p/:projectId/report/:date', () => import('./views/report.js')],
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

let renderToken = 0;

async function render() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const token = ++renderToken;
  const hit = match(path);

  backBtn.hidden = path === '/' || path === '/lib' || path === '/settings';
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
  const active = path.startsWith('/lib') ? 'lib'
    : path.startsWith('/settings') ? 'settings'
    : 'projects';
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.classList.toggle('active', a.dataset.tab === active);
  }
}

backBtn.addEventListener('click', () => history.back());

/** 頂端的方案標示。付費層與免費層在保密上差很多，所以永遠顯示著。 */
export async function refreshTierBadge() {
  const badge = document.getElementById('tier-badge');
  const key = await getSetting('geminiApiKey', '');
  const tier = await getSetting('geminiTier', '');
  if (!key) {
    badge.className = 'tier tier-off';
    badge.textContent = '未設定 AI';
  } else if (tier === 'paid') {
    badge.className = 'tier tier-paid';
    badge.textContent = '付費層';
  } else {
    badge.className = 'tier tier-free';
    badge.textContent = '免費層';
  }
}

window.addEventListener('hashchange', render);

window.addEventListener('error', (e) => {
  console.error('uncaught', e.error || e.message);
});

/** 外殼的 icon 也從 icons.js 來，才不會有兩份圖示定義各走各的。 */
function paintChromeIcons() {
  backBtn.replaceChildren(icon('chevronLeft', { size: 24 }));
  const tabIcons = { projects: 'building', lib: 'layers', settings: 'sliders' };
  for (const a of document.querySelectorAll('#tabbar a')) {
    a.querySelector('.ico')?.replaceChildren(icon(tabIcons[a.dataset.tab], { size: 22 }));
  }
}

(async function boot() {
  setTitle('監造工地筆記');
  paintChromeIcons();
  await refreshTierBadge();
  requestPersistence().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
  }

  await render();
})().catch((err) => {
  console.error(err);
  view.replaceChildren(el('div', { class: 'empty' }, [
    el('strong', { text: '啟動失敗' }),
    el('p', { class: 'muted', text: String(err?.message || err) }),
  ]));
  toast('啟動失敗，請看主控台');
});
