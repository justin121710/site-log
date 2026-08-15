// Service worker：把 App 本體整包快取，工地沒訊號也要能開得起來。
//
// 策略：
//   - 程式碼（html/js/css）走 network-first：有網路時一定拿到最新版，離線才退回快取。
//     不用 cache-first 是因為那會讓「改版後使用者還在跑舊程式」變成常態，
//     而且我一旦忘記換 CACHE 名字，舊檔就永遠不會更新。
//   - 圖示與 manifest 走 cache-first，它們幾乎不變，沒必要每次都連。
//   - Gemini 的請求完全不碰 SW，離線就是離線，不要假裝有結果。

const CACHE = 'site-log-v23';

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/ui.js',
  'js/db.js',
  'js/taxonomy.js',
  'js/icons.js',
  'js/twzones.js',
  'js/exif.js',
  'js/glossary.js',
  'js/gemini.js',
  'js/redact.js',
  'js/media.js',
  'js/watermark.js',
  'js/search.js',
  'js/views/search.js',
  'js/laws.js',
  'js/views/laws.js',
  // 法規包 421KB。跟程式一起快取，工地沒訊號才查得到——
  // 那正是他最需要查「這件事我到底該不該擋」的時候。
  'data/laws.json',
  'data/specs.json',
  'js/zip.js',
  'js/unzip.js',
  'js/restore.js',
  'js/export.js',
  'js/export-all.js',
  'js/export-ui.js',
  'js/markdown.js',
  'js/confirm-upload.js',
  'js/report-template.js',
  'js/report-html.js',
  'js/views/projects.js',
  'js/views/project.js',
  'js/views/project-edit.js',
  'js/views/day.js',
  'js/views/entry.js',
  'js/views/report.js',
  'js/views/reports.js',
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
    // 個別 add，某一個檔 404 不要害整包裝不起來。
    // cache: 'reload' 是必要的：少了它，預快取會走瀏覽器自己的 HTTP 快取，
    // 而 GitHub Pages 給 max-age=600——改版後最多十分鐘內裝進來的還是舊檔。
    // 程式碼那條路有 network-first 兜底看不出來，但 data/laws.json 走 cache-first，
    // 一裝到舊的就會一直是舊的，直到下次換 CACHE 名字。
    await Promise.all(ASSETS.map((u) => cache
      .add(new Request(u, { cache: 'reload' }))
      .catch((err) => console.warn('快取失敗', u, err))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/** 程式碼類檔案要走 network-first，改版才會即時生效。 */
function isCode(url, request) {
  return request.mode === 'navigate' || /\.(?:js|mjs|css|html)$/.test(url.pathname);
}

async function putInCache(request, response) {
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return; // Gemini 等外部請求不攔

  e.respondWith((async () => {
    if (isCode(url, e.request)) {
      try {
        // cache: 'no-cache' 會強制向伺服器驗證。少了這個，GitHub Pages 的
        // max-age=600 會讓使用者在改版後最多還跑十分鐘的舊程式。
        // 檔案沒變時伺服器回 304，成本很低。
        return await putInCache(e.request, await fetch(e.request, { cache: 'no-cache' }));
      } catch {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        // 導覽請求離線時退回外殼，PWA 才不會變成錯誤畫面
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        throw new Error('離線且沒有快取');
      }
    }

    const cached = await caches.match(e.request);
    if (cached) return cached;
    return putInCache(e.request, await fetch(e.request));
  })());
});
