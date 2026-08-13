// IndexedDB 資料層。所有現場資料都留在裝置上，這一層不做任何網路呼叫。
//
// stores:
//   settings  key-value（API key、代號對照表、子項表…）
//   projects  專案 + 監造日報表頭欄位
//   days      當日工地資訊，一天一筆（天氣/廠商/人機數量），key = `${projectId}|${date}`
//   entries   一筆記錄 = 一個專案 + 多個類型
//   media     照片與錄音的 Blob，跟 entry 分開存，避免讀清單時把幾百 MB 全載進記憶體
//   reports   當日日報（五段式 + 自由摘要）

const DB_NAME = 'site-log';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const tx = req.transaction;

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('projects')) {
        const s = db.createObjectStore('projects', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('days')) {
        const s = db.createObjectStore('days', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
        s.createIndex('projectDate', ['projectId', 'date']);
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
        s.createIndex('projectDate', ['projectId', 'date']);
        s.createIndex('capturedAt', 'capturedAt');
        // multiEntry：一筆記錄有多個類型，工項分類要能用任一類型查到它
        s.createIndex('categoryIds', 'categoryIds', { multiEntry: true });
      }
      if (!db.objectStoreNames.contains('media')) {
        const s = db.createObjectStore('media', { keyPath: 'id' });
        s.createIndex('entryId', 'entryId');
      }
      if (!db.objectStoreNames.contains('reports')) {
        const s = db.createObjectStore('reports', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      void tx;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('資料庫被其他分頁佔住，請關掉其他開著本 App 的分頁'));
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid(prefix = '') {
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = [...rand].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${Date.now().toString(36)}${hex}`;
}

export async function get(store, key) {
  return wrap((await tx(store)).get(key));
}

export async function getAll(store) {
  return wrap((await tx(store)).getAll());
}

export async function put(store, value) {
  await wrap((await tx(store, 'readwrite')).put(value));
  return value;
}

export async function del(store, key) {
  return wrap((await tx(store, 'readwrite')).delete(key));
}

export async function getAllByIndex(store, indexName, query) {
  const os = await tx(store);
  return wrap(os.index(indexName).getAll(query));
}

export async function countByIndex(store, indexName, query) {
  const os = await tx(store);
  return wrap(os.index(indexName).count(query));
}

// ---------- settings ----------

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row === undefined ? fallback : row.value;
}

export async function setSetting(key, value) {
  return put('settings', { key, value });
}

// ---------- projects ----------

export function newProject(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: uid('p_'),
    name: '',
    code: '', // 代號，送 AI 時用它取代真實案名
    contractNo: '',
    agency: '',
    contractor: '',
    startDate: '',
    plannedEndDate: '',
    contractDays: '',
    contractAmount: '',
    plannedProgress: '',
    actualProgress: '',
    supervisorUnit: '',
    // 工址。工地不會移動，所以行政區屬於專案，不該每張照片重存一次。
    site: { county: '', district: '', village: '', address: '' },
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

export async function listProjects() {
  const rows = await getAll('projects');
  return rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  return put('projects', project);
}

// ---------- days（當日工地資訊，一天填一次）----------

export function dayId(projectId, date) {
  return `${projectId}|${date}`;
}

export function newDay(projectId, date) {
  return {
    id: dayId(projectId, date),
    projectId,
    date,
    weatherAM: '',
    weatherPM: '',
    contractors: '',
    manpower: '',
    equipment: '',
    plannedProgress: '',
    actualProgress: '',
    updatedAt: new Date().toISOString(),
  };
}

export async function getOrCreateDay(projectId, date) {
  return (await get('days', dayId(projectId, date))) ?? newDay(projectId, date);
}

export async function saveDay(day) {
  day.updatedAt = new Date().toISOString();
  return put('days', day);
}

// ---------- entries ----------

export function newEntry(projectId, date) {
  const now = new Date().toISOString();
  return {
    id: uid('e_'),
    projectId,
    date, // YYYY-MM-DD，本地時區
    capturedAt: now,
    categoryIds: [],
    subtags: [],
    floor: '',
    gridline: '',
    area: '',
    note: '', // 你自己打的
    transcript: '', // 逐字稿（iOS 聽寫或 Gemini）
    transcriptSource: '', // dictation | gemini | manual
    ai: null, // { fields, suggestedCategories, tidied, model, at }
    verified: false, // 你勾「已確認」才會變 true
    verifiedNote: '', // 依據：規範章節 / 誰說的
    // 缺失追蹤：改正往往是幾天後的另一筆記錄，沒有單號就串不起來，
    // 追蹤表會退化成「所有缺失按日期排」的清單。
    defectNo: '',
    defectStatus: '', // 開立 | 改正中 | 已複驗
    gps: null, // { lat, lng, acc }
    createdAt: now,
    updatedAt: now,
  };
}

export async function listEntries(projectId, date = null) {
  const rows = date
    ? await getAllByIndex('entries', 'projectDate', IDBKeyRange.only([projectId, date]))
    : await getAllByIndex('entries', 'projectId', IDBKeyRange.only(projectId));
  return rows.sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''));
}

export async function listEntriesByCategory(categoryId) {
  const rows = await getAllByIndex('entries', 'categoryIds', IDBKeyRange.only(categoryId));
  return rows.sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''));
}

export async function saveEntry(entry) {
  entry.updatedAt = new Date().toISOString();
  return put('entries', entry);
}

export const DEFECT_STATUSES = ['開立', '改正中', '已複驗'];

/**
 * 這個專案的下一個缺失單號。只認得 D-001 這種格式，
 * 你改成公司自己的編號規則之後就不會再被自動編號干擾。
 */
export async function nextDefectNo(projectId) {
  const rows = await listEntries(projectId);
  let max = 0;
  for (const e of rows) {
    const m = /^D-(\d+)$/.exec((e.defectNo || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `D-${String(max + 1).padStart(3, '0')}`;
}

/** 把同一個單號的記錄歸成一組，時間由早到晚。 */
export async function groupDefects(projectId) {
  const rows = (await listEntries(projectId)).filter((e) => (e.defectNo || '').trim());
  const groups = new Map();
  for (const e of rows) {
    const no = e.defectNo.trim();
    if (!groups.has(no)) groups.set(no, []);
    groups.get(no).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.capturedAt || '').localeCompare(b.capturedAt || ''));
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([no, entries]) => ({
      no,
      entries,
      // 狀態以最後一筆有填的為準——改正是後來才發生的事
      status: [...entries].reverse().find((e) => e.defectStatus)?.defectStatus || '開立',
      openedAt: entries[0].date,
    }));
}

export async function deleteEntry(entryId) {
  for (const m of await listMedia(entryId)) await del('media', m.id);
  await del('entries', entryId);
}

// ---------- media ----------

export async function addMedia({ entryId, kind, blob, mime, width, height, duration }) {
  const row = {
    id: uid('m_'),
    entryId,
    kind, // photo | audio
    blob,
    mime: mime || blob.type,
    width: width ?? null,
    height: height ?? null,
    duration: duration ?? null,
    size: blob.size,
    // 施工照片表需要「每一張」各自的說明。改正前與改正後常常在同一筆記錄裡，
    // 共用一段文字的話兩張的圖說會一模一樣。
    tag: '', // 改正前 / 改正後 / 全景 …
    caption: '', // 留空時報表自動用記錄的文字
    createdAt: new Date().toISOString(),
  };
  await put('media', row);
  return row;
}

export async function listMedia(entryId) {
  const rows = await getAllByIndex('media', 'entryId', IDBKeyRange.only(entryId));
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function deleteMedia(mediaId) {
  return del('media', mediaId);
}

/** 只更新照片的標籤與說明，不動 blob。 */
export async function updateMedia(mediaId, fields) {
  const row = await get('media', mediaId);
  if (!row) return null;
  return put('media', { ...row, ...fields });
}

/** 施工照片表用的標籤。順序就是它們在工地被拍到的順序。 */
export const PHOTO_TAGS = ['全景', '近照', '量測', '材料', '改正前', '改正後'];

// ---------- reports ----------

export function reportId(projectId, date) {
  return `${projectId}|${date}`;
}

export async function getReport(projectId, date) {
  return get('reports', reportId(projectId, date));
}

export async function saveReport(report) {
  report.updatedAt = new Date().toISOString();
  return put('reports', report);
}

// ---------- 容量 ----------

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

/** 要求持久化儲存，降低 iOS/瀏覽器在空間不足時清掉資料的機率。 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

/**
 * 瀏覽器有沒有真的答應幫你留著。
 * @returns {Promise<boolean|null>} null = 這個瀏覽器沒有這個 API，無從得知
 */
export async function isPersisted() {
  if (!navigator.storage?.persisted) return null;
  return navigator.storage.persisted();
}
