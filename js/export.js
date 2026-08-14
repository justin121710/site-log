// 匯出。兩種格式，用途完全不同：
//
//   完整備份 zip —— 給「手機掛掉也救得回來」用。含原始 JSON 與原檔照片、錄音。
//   Markdown zip —— 給「收進 Notion／Obsidian」用。人看得懂，但不是完整資料。
//
// buildBackup()／buildMarkdown() 只負責打包不送出，exportBackup()／exportMarkdown()
// 才會叫分享選單。分開是為了讓 export-all.js 能把兩包跟報表併成同一批分享。
//
// 刻意不做自動雲端同步：iOS 的「加到主畫面」PWA 一跑 OAuth 就會被踢到 Safari 分頁回不來，
// 而且那等於把整包工地資料交給第三方服務，跟這個 App 的其他設計互相矛盾。
// 手動匯出走 iOS 分享選單雖然土，但它一定會成功，而且每一次都是你自己按的。

import { getAll, listMedia, listEntries, getOrCreateDay, get, getSetting, setSetting } from './db.js';
import { makeZip } from './zip.js';
import { today, toast } from './ui.js';
import { renderDocument } from './markdown.js';

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

/** 檔名裡不能出現的字元換掉，避免解壓或匯入時出錯。 */
function safe(name) {
  return (name || '未命名').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || '未命名';
}

function jsonBlob(obj) {
  return new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
}

/**
 * 依範圍挑出要匯出的記錄。
 * @param {{ projectId?: string, date?: string }} scope 全空 = 全部
 */
async function collectEntries({ projectId, date } = {}) {
  const all = await getAll('entries');
  return all.filter((e) => {
    if (projectId && e.projectId !== projectId) return false;
    if (date && e.date !== date) return false;
    return true;
  });
}

// ---------- 完整備份 ----------

/**
 * 打包完整備份，但先不送出。一鍵全部匯出要把它跟報表、Markdown 併成同一批分享。
 * @param {{ projectId?: string, date?: string }} scope
 */
export async function buildBackup(scope = {}) {
  const isFull = !scope.projectId && !scope.date;

  const [projects, allEntries, days, reports, settings] = await Promise.all([
    getAll('projects'), getAll('entries'), getAll('days'), getAll('reports'), getAll('settings'),
  ]);

  const entries = await collectEntries(scope);
  const entryIds = new Set(entries.map((e) => e.id));

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
      const dir = `media/${e.projectId ? projectName[e.projectId] || '未分類專案' : '未歸專案'}/${e.date || '無日期'}`;
      const path = `${dir}/${e.id}_${String(i).padStart(2, '0')}.${extFor(m.mime)}`;
      files.push({ name: path, blob: m.blob });
      mediaIndex.push({ id: m.id, entryId: e.id, kind: m.kind, mime: m.mime, path, size: m.size });
    }
  }

  const manifest = {
    app: 'site-log',
    schema: 1,
    exportedAt: new Date().toISOString(),
    scope: isFull ? 'full' : scope,
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
    { name: 'data/entries.json', blob: jsonBlob(isFull ? allEntries : entries) },
    { name: 'data/days.json', blob: jsonBlob(days) },
    { name: 'data/reports.json', blob: jsonBlob(reports) },
    { name: 'data/settings.json', blob: jsonBlob(safeSettings) },
    { name: 'data/media-index.json', blob: jsonBlob(mediaIndex) },
    { name: 'README.txt', blob: new Blob([BACKUP_README], { type: 'text/plain;charset=utf-8' }) },
  );

  const zip = await makeZip(files);
  const label = await scopeLabel(scope);

  return {
    blob: zip,
    filename: `site-log-備份-${label}-${today()}.zip`,
    isFull,
    entries: entries.length,
    media: mediaIndex.length,
  };
}

/**
 * @param {{ projectId?: string, date?: string }} scope
 */
export async function exportBackup(scope = {}) {
  const backup = await buildBackup(scope);
  const mode = await share(backup.blob, backup.filename);
  // 只有整包備份才算數。單日匯出救不回整支手機。
  if (backup.isFull && mode !== 'cancelled') await markBackedUp();
  return { entries: backup.entries, media: backup.media, bytes: backup.blob.size, mode };
}

export async function markBackedUp() {
  await setSetting('lastBackupAt', new Date().toISOString());
}

// ---------- Markdown ----------

/**
 * 匯出成 Notion／Obsidian 讀得懂的 Markdown zip，照片一起打包。
 * Notion 只認得 zip 內的相對路徑，所以 .md 跟 images/ 必須在同一個資料夾底下。
 */
export async function buildMarkdown(scope = {}) {
  const entries = await collectEntries(scope);
  if (!entries.length) throw new Error('這個範圍裡沒有記錄');

  const project = scope.projectId ? await get('projects', scope.projectId) : null;
  const day = scope.projectId && scope.date ? await getOrCreateDay(scope.projectId, scope.date) : null;

  const label = await scopeLabel(scope);
  const folder = safe(`${label}-${today()}`);

  const files = [];
  const imagePaths = new Map();

  for (const e of entries) {
    const media = await listMedia(e.id);
    const paths = [];
    let i = 0;
    for (const m of media.filter((x) => x.kind === 'photo')) {
      i++;
      const rel = `images/${e.id}_${String(i).padStart(2, '0')}.${extFor(m.mime)}`;
      files.push({ name: `${folder}/${rel}`, blob: m.blob });
      paths.push(rel);
    }
    imagePaths.set(e.id, paths);
  }

  const md = renderDocument({
    title: label,
    project,
    day,
    entries,
    imagePathsFor: (e) => imagePaths.get(e.id) || [],
  });

  files.unshift(
    { name: `${folder}/${folder}.md`, blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }) },
    { name: `${folder}/匯入說明.txt`, blob: new Blob([MD_README], { type: 'text/plain;charset=utf-8' }) },
  );

  const zip = await makeZip(files);
  return {
    blob: zip,
    filename: `${folder}-markdown.zip`,
    entries: entries.length,
    images: files.length - 2,
  };
}

/**
 * @param {{ projectId?: string, date?: string }} scope
 */
export async function exportMarkdown(scope = {}) {
  const md = await buildMarkdown(scope);
  const mode = await share(md.blob, md.filename);
  return { entries: md.entries, images: md.images, bytes: md.blob.size, mode };
}

/** 純文字版，給「直接複製貼上」用。沒有照片。 */
export async function markdownText(scope = {}) {
  const entries = await collectEntries(scope);
  const project = scope.projectId ? await get('projects', scope.projectId) : null;
  const day = scope.projectId && scope.date ? await getOrCreateDay(scope.projectId, scope.date) : null;
  return renderDocument({ title: await scopeLabel(scope), project, day, entries });
}

// ---------- 共用 ----------

async function scopeLabel({ projectId, date } = {}) {
  if (projectId) {
    const p = await get('projects', projectId);
    const name = safe(p?.code || p?.name || '專案');
    return date ? `${name}-${date}` : name;
  }
  if (date) return `全部專案-${date}`;
  return '全部';
}

/**
 * 把一份 HTML／文字檔送出去。走分享選單而不是 window.print()，
 * 因為「加到主畫面」的 PWA 是 standalone 模式，沒有 Safari 的分享列，
 * 不保證叫得出列印介面。存成檔案再用 Safari 開，這條一定會通。
 */
export async function shareTextFile(text, filename, mime = 'text/html;charset=utf-8') {
  await share(new Blob([text], { type: mime }), filename);
}

/**
 * iOS 上優先走分享選單，使用者才能直接選「儲存到檔案」或雲端硬碟。
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
async function share(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'; // 使用者自己取消，不算失敗
      // 其他錯誤就退回下載
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('已開始下載');
  return 'downloaded';
}

/**
 * 一次把好幾個檔案交給分享選單。iOS 的分享選單吃得下多檔，
 * 「儲存到檔案」會把整批存進同一個資料夾——這就是一鍵全部匯出想要的結果。
 *
 * 吃不下（桌機瀏覽器、舊版 iOS）就退回打包成一個 zip 再分享一次。
 * 反正裡面的東西一樣，仍然是「按一次」。
 *
 * @param {{name: string, blob: Blob}[]} files
 * @param {string} bundleName 退回打包時用的 zip 檔名
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
export async function shareFiles(files, bundleName) {
  const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (asFiles.length > 1 && navigator.canShare?.({ files: asFiles })) {
    try {
      await navigator.share({ files: asFiles, title: bundleName });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // 其他錯誤就退回打包
    }
  }
  return share(await makeZip(files), bundleName);
}

// ---------- 備份狀態 ----------

export async function getLastBackup() {
  const iso = await getSetting('lastBackupAt', null);
  if (!iso) return { iso: null, days: null };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return { iso, days };
}

/** 幾天沒整包備份就開始念。工地資料重做不回來，寧可煩一點。 */
export const BACKUP_NAG_DAYS = 7;

export async function backupIsOverdue() {
  const { iso, days } = await getLastBackup();
  const entries = await getAll('entries');
  if (!entries.length) return false; // 還沒東西可備份，不要嚇人
  if (!iso) return true;
  return days >= BACKUP_NAG_DAYS;
}

const BACKUP_README = `監造工地筆記 — 完整備份

data/          所有文字資料（JSON）
media/         照片與錄音原檔，依「專案／日期」分資料夾
manifest.json  這份備份的摘要

照片是原圖，沒有燒浮水印。浮水印只在 App 裡顯示與分享照片時才疊上去。
Gemini API key 不包含在這份備份裡，還原後要重新貼一次。
`;

const MD_README = `這包是給 Notion／Obsidian 匯入用的，不是完整備份。

Notion：左下角 Settings → Import → Markdown & CSV，直接選這個 .zip。
照片放在 images/ 底下，用相對路徑連結，跟著 zip 一起匯入才會顯示。
如果你把 .md 單獨拉出來，圖片連結就會失效。

要真正的備份請用 App 裡的「完整備份」，那份才含得回原始資料。
`;
