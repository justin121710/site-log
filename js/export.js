// 備份匯出：把整個資料庫打包成一個 zip，走 iOS 分享選單存到「檔案」或雲端硬碟。
//
// 刻意不做自動雲端同步：iOS 的「加到主畫面」PWA 一跑 OAuth 就會被踢到 Safari 分頁回不來。
// 手動匯出雖然土，但它一定會成功。

import { getAll, listMedia } from './db.js';
import { makeZip } from './zip.js';
import { today, toast } from './ui.js';

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

function extFor(mime) {
  return EXT[(mime || '').split(';')[0]] || 'bin';
}

/** 檔名裡不能出現的字元換掉，避免解壓時出錯。 */
function safe(name) {
  return (name || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}

export async function exportBackup() {
  const [projects, entries, days, reports, settings] = await Promise.all([
    getAll('projects'), getAll('entries'), getAll('days'), getAll('reports'), getAll('settings'),
  ]);

  // API key 不進備份。備份檔會被丟到雲端硬碟，key 不該跟著跑。
  const safeSettings = settings.filter((s) => s.key !== 'geminiApiKey');

  const projectName = Object.fromEntries(projects.map((p) => [p.id, safe(p.name)]));
  const files = [];
  const mediaIndex = [];

  for (const e of entries) {
    const media = await listMedia(e.id);
    let i = 0;
    for (const m of media) {
      i++;
      const dir = `media/${projectName[e.projectId] || '未分類專案'}/${e.date || '無日期'}`;
      const path = `${dir}/${e.id}_${String(i).padStart(2, '0')}.${extFor(m.mime)}`;
      files.push({ name: path, blob: m.blob });
      mediaIndex.push({ id: m.id, entryId: e.id, kind: m.kind, mime: m.mime, path, size: m.size });
    }
  }

  const manifest = {
    app: 'site-log',
    schema: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      projects: projects.length,
      entries: entries.length,
      media: mediaIndex.length,
      reports: reports.length,
    },
    note: 'media 欄位裡的 path 對應 zip 內的檔案位置。API key 不含在備份中。',
  };

  files.unshift(
    { name: 'manifest.json', blob: jsonBlob(manifest) },
    { name: 'data/projects.json', blob: jsonBlob(projects) },
    { name: 'data/entries.json', blob: jsonBlob(entries) },
    { name: 'data/days.json', blob: jsonBlob(days) },
    { name: 'data/reports.json', blob: jsonBlob(reports) },
    { name: 'data/settings.json', blob: jsonBlob(safeSettings) },
    { name: 'data/media-index.json', blob: jsonBlob(mediaIndex) },
    { name: 'README.txt', blob: new Blob([README], { type: 'text/plain;charset=utf-8' }) },
  );

  const zip = await makeZip(files);
  const filename = `site-log-備份-${today()}.zip`;

  // iOS 上優先用分享選單，使用者才能直接選「儲存到檔案」或雲端硬碟。
  const file = new File([zip], filename, { type: 'application/zip' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // 使用者自己取消，不算失敗
      // 其他錯誤就退回下載
    }
  }

  const url = URL.createObjectURL(zip);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('已開始下載備份');
}

function jsonBlob(obj) {
  return new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
}

const README = `監造工地筆記 — 備份

data/        所有文字資料（JSON）
media/       照片與錄音，依「專案／日期」分資料夾
manifest.json  這份備份的摘要

照片是原圖，沒有燒浮水印。浮水印只在 App 裡顯示與匯出照片時才疊上去。
Gemini API key 不包含在這份備份裡，還原後要重新貼一次。
`;
