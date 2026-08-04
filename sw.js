// Service worker：把 App 本體整包快取，工地沒訊號也要能開得起來。
//
// 策略：
//   - App 檔案走 cache-first，因為它們跟著版本走，改版就換 CACHE 名字。
//   - Gemini 的請求完全不碰 SW，離線就是離線，不要假裝有結果。

const CACHE = 'site-log-v1';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/ui.js',
  'js/db.js',
  'js/taxonomy.js',
  'js/glossary.js',
  'js/gemini.js',
  'js/redact.js',
  'js/media.js',
  'js/watermark.js',
  'js/zip.js',
  'js/export.js',
  'js/confirm-upload.js',
  'js/report-template.js',
  'js/views/projects.js',
  'js/views/project.js',
  'js/views/project-edit.js',
  'js/views/day.js',
  'js/views/entry.js',
  'js/views/report.js',
  'js/views/library.js',
  'js/views/category.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 個別 add，某一個檔 404 不要害整包裝不起來
    await Promise.all(ASSETS.map((u) => cache.add(u).catch((err) => console.warn('快取失敗', u, err))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // Gemini 等外部請求不攔

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch {
      // 導覽請求離線時退回首頁，PWA 才不會變成錯誤畫面
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw new Error('離線且沒有快取');
    }
  })());
});
