// 一鍵全部匯出。
//
// 「分享 → 儲存到檔案 → OneDrive」本來就做得到，這個按鈕省的是次數：
// 報表、完整備份、Markdown 一次做完，一次交給分享選單，
// 變成做一次分享動作而不是三次。純本機，不登入任何服務。
//
// 報表挑什麼看範圍：
//   某一天   → 那天的監造日報（含施工照片表）
//   一個專案 → 專案完整本，有缺失單號就多一份缺失追蹤表
//   全部     → 每個有記錄的專案各來一套
//
// 沒歸專案的記錄不會有報表（報表都是以專案為單位的表格），
// 但備份與 Markdown 一樣收得到，資料不會漏。

import {
  get, getAll, listProjects, listEntries, listMedia,
  getOrCreateDay, getReport, groupDefects,
} from './db.js';
import { buildBackup, buildMarkdown, shareFiles, markBackedUp } from './export.js';
import { buildDailyReportHtml, buildProjectBookHtml, buildDefectReportHtml } from './report-html.js';
import { buildLocalDraft } from './report-template.js';
import { today } from './ui.js';

// 報表裡的照片是重新編碼成 data URI 疊進 HTML 的，張數一多會在手機上爆記憶體。
// 超過這個數字就讓報表純文字——原圖一張不少，就在同一批的備份 zip 裡。
const MAX_REPORT_PHOTOS = 300;

/**
 * @param {{ projectId?: string, date?: string }} scope
 * @param {{ onStep?: (text: string) => void }} opts
 */
export async function exportEverything(scope = {}, { onStep } = {}) {
  const entries = await entriesInScope(scope);
  if (!entries.length) throw new Error('這個範圍裡沒有記錄');

  const photos = await countPhotos(entries);
  const withPhotos = photos <= MAX_REPORT_PHOTOS;

  onStep?.('產生報表…');
  const reports = await buildReports(scope, withPhotos);

  onStep?.('打包備份…');
  const backup = await buildBackup(scope);

  onStep?.('整理 Markdown…');
  const md = await buildMarkdown(scope);

  const used = new Set();
  const files = [
    ...reports.map((r) => ({
      name: uniqueName(cleanName(r.filename), used),
      blob: new Blob([r.html], { type: 'text/html;charset=utf-8' }),
    })),
    { name: uniqueName(backup.filename, used), blob: backup.blob },
    { name: uniqueName(md.filename, used), blob: md.blob },
  ];

  onStep?.('準備分享…');
  const mode = await shareFiles(files, `site-log-全部匯出-${today()}.zip`);
  if (backup.isFull && mode !== 'cancelled') await markBackedUp();

  return {
    mode,
    reports: reports.length,
    entries: entries.length,
    media: backup.media,
    images: md.images,
    droppedPhotos: withPhotos ? 0 : photos,
    bytes: files.reduce((n, f) => n + f.blob.size, 0),
  };
}

// ---------- 報表 ----------

async function buildReports(scope, withPhotos) {
  const out = [];

  if (scope.projectId && scope.date) {
    const project = await get('projects', scope.projectId);
    const entries = await listEntries(scope.projectId, scope.date);
    if (project && entries.length) {
      out.push(await dailyReport(project, scope.date, entries, withPhotos));
    }
    return out;
  }

  const projects = scope.projectId
    ? [await get('projects', scope.projectId)].filter(Boolean)
    : await listProjects();

  for (const p of projects) {
    const list = await listEntries(p.id);
    if (!list.length) continue;
    out.push(await buildProjectBookHtml({
      project: p, entries: list, days: await daysMap(p.id), withPhotos,
    }));
    const groups = await groupDefects(p.id);
    if (groups.length) out.push(await buildDefectReportHtml({ project: p, groups, withPhotos }));
  }
  return out;
}

/**
 * 這一天的監造日報。還沒產過就用本機草稿——只搬他自己打的字，不會呼叫 AI，
 * 也不會寫回 reports store：一鍵匯出不該偷改他的日報內容。
 */
async function dailyReport(project, date, entries, withPhotos) {
  const saved = await getReport(project.id, date);
  const draft = saved?.sections ? null : buildLocalDraft({ entries });
  return buildDailyReportHtml({
    project,
    day: await getOrCreateDay(project.id, date),
    date,
    entries,
    sections: saved?.sections || draft,
    freeSummary: saved?.freeSummary || draft?.freeSummary || '',
    withPhotos,
  });
}

async function daysMap(projectId) {
  const rows = (await getAll('days')).filter((d) => d.projectId === projectId);
  return Object.fromEntries(rows.map((d) => [d.date, d]));
}

// ---------- 共用 ----------

async function entriesInScope({ projectId, date } = {}) {
  if (projectId) return listEntries(projectId, date || null);
  const all = await getAll('entries');
  return date ? all.filter((e) => e.date === date) : all;
}

async function countPhotos(entries) {
  let n = 0;
  for (const e of entries) n += (await listMedia(e.id)).filter((m) => m.kind === 'photo').length;
  return n;
}

function cleanName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/** 兩個沒填代號的專案會產出一模一樣的檔名，同一批裡不能有兩個一樣的。 */
function uniqueName(name, used) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  let i = 1;
  while (used.has(candidate)) candidate = `${base}-${++i}${ext}`;
  used.add(candidate);
  return candidate;
}
