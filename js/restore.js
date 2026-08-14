// 從備份 zip 還原。匯出的反向操作。
//
// 一份救不回來的備份不算備份。App 首頁會念「幾天沒備份了」，
// 那句話要成立，這條路就得走得通。
//
// 兩種模式，匯入時由使用者選：
//   合併 —— 備份裡有的就寫進來（同 id 以備份為準），本機多出來的原封不動留著。
//            換手機、補回舊資料都適用，不會因為匯錯一包舊備份就洗掉今天記的東西。
//   取代 —— 先清空再寫。結果最乾淨可預測，但按錯就沒得救，所以要再確認一次。
//
// API key 兩種模式都不動：備份裡本來就沒有 key（刻意的），
// 還原時把本機那把刪掉只會害他重貼一次。

import {
  put, getAll, getSetting, setSetting, clearStore, listMedia, del,
} from './db.js';
import { openZip } from './unzip.js';

const DATA_FILES = {
  projects: 'data/projects.json',
  entries: 'data/entries.json',
  days: 'data/days.json',
  reports: 'data/reports.json',
  settings: 'data/settings.json',
};

/**
 * 讀出備份內容並檢查它是不是這個 App 產的。還沒有寫進任何東西。
 * @param {File} file
 */
export async function readBackup(file) {
  const zip = await openZip(file);

  if (!zip.has('manifest.json')) {
    throw new Error('這包 zip 裡沒有 manifest.json，不是本 App 的完整備份');
  }
  const manifest = await zip.json('manifest.json');
  if (manifest?.app !== 'site-log') throw new Error('這是別的 App 的備份檔');

  const data = {};
  for (const [key, path] of Object.entries(DATA_FILES)) {
    data[key] = zip.has(path) ? await zip.json(path) : [];
    if (!Array.isArray(data[key])) throw new Error(`${path} 的格式不對`);
  }
  const mediaIndex = zip.has('data/media-index.json') ? await zip.json('data/media-index.json') : [];

  // 對得到檔案的才算數。Markdown zip 或只含 data/ 的半包備份不會憑空生出照片。
  const media = mediaIndex.filter((m) => m.path && zip.has(m.path));

  return {
    zip,
    manifest,
    ...data,
    media,
    missingMedia: mediaIndex.length - media.length,
    exportedAt: manifest.exportedAt || '',
    scope: manifest.scope || '',
  };
}

/**
 * 真正寫進 IndexedDB。
 * @param {Awaited<ReturnType<readBackup>>} backup
 * @param {'merge'|'replace'} mode
 * @param {(text: string) => void} [onStep]
 */
export async function restoreBackup(backup, mode, onStep) {
  const replace = mode === 'replace';
  // key 只在本機，備份裡沒有。清空前先接住，寫回去的時候還給他。
  const apiKey = await getSetting('geminiApiKey', '');

  if (replace) {
    onStep?.('清空現有資料…');
    for (const s of ['media', 'entries', 'days', 'reports', 'projects', 'settings']) {
      await clearStore(s);
    }
  }

  onStep?.('寫入設定…');
  await restoreSettings(backup.settings, replace);
  if (apiKey) await setSetting('geminiApiKey', apiKey);

  onStep?.('寫入專案與記錄…');
  for (const p of backup.projects) await put('projects', p);
  for (const d of backup.days) await put('days', d);
  for (const e of backup.entries) await put('entries', e);
  for (const r of backup.reports) await put('reports', r);

  // 合併時同一筆記錄的舊照片先清掉，不然還原兩次就會出現兩份一樣的照片。
  if (!replace) {
    onStep?.('整理照片…');
    const touched = new Set(backup.media.map((m) => m.entryId));
    for (const entryId of touched) {
      for (const old of await listMedia(entryId)) await del('media', old.id);
    }
  }

  let done = 0;
  for (const m of backup.media) {
    const { path, ...row } = m;
    row.blob = await backup.zip.blob(path, row.mime || '');
    row.size = row.blob.size;
    await put('media', row);
    if (++done % 20 === 0) onStep?.(`寫入照片與錄音… ${done}/${backup.media.length}`);
  }

  return {
    projects: backup.projects.length,
    entries: backup.entries.length,
    media: backup.media.length,
    missingMedia: backup.missingMedia,
  };
}

/**
 * 設定的合併規則。
 *
 * 取代模式直接照抄。合併模式的原則是「補回缺的，不動你現在的」——
 * 但自訂分類與子項是記錄會引用的東西，少了它們，匯進來的記錄會掛著
 * 一個查不到名字的分類 id，所以這兩個一律取聯集。
 */
async function restoreSettings(rows, replace) {
  const skip = new Set(['geminiApiKey', 'lastBackupAt']);

  for (const row of rows) {
    if (!row?.key || skip.has(row.key)) continue;

    if (replace) {
      await setSetting(row.key, row.value);
      continue;
    }

    if (row.key === 'customCategories') {
      const mine = await getSetting('customCategories', []);
      const seen = new Set(mine.map((c) => c.id));
      await setSetting('customCategories', [...mine, ...row.value.filter((c) => !seen.has(c.id))]);
      continue;
    }

    if (row.key === 'subtags') {
      const mine = await getSetting('subtags', {});
      for (const [catId, list] of Object.entries(row.value || {})) {
        mine[catId] = [...new Set([...(mine[catId] || []), ...list])];
      }
      await setSetting('subtags', mine);
      continue;
    }

    const existing = await getSetting(row.key, undefined);
    if (existing === undefined) await setSetting(row.key, row.value);
  }
}

/** 現在裝置上有多少東西會被這次還原影響到，拿來讓使用者按下去之前先看一眼。 */
export async function currentCounts() {
  const [projects, entries, media] = await Promise.all([
    getAll('projects'), getAll('entries'), getAll('media'),
  ]);
  return { projects: projects.length, entries: entries.length, media: media.length };
}
