// 設定：Gemini key／方案、逐字稿預設來源、代號對照表、敏感詞、儲存空間、備份。

import {
  el, append, setTitle, field, input, toast, fmtBytes, confirmDialog, flushActiveInput,
} from '../ui.js';
import { getSetting, setSetting, storageEstimate, listProjects, isPersisted } from '../db.js';
import { refreshTierBadge } from '../app.js';
import { DEFAULT_MODEL, FALLBACK_MODELS, testKey, listModels } from '../gemini.js';
import { getAliases, setAliases, getExtraSensitive, setExtraSensitive } from '../redact.js';
import { getLastBackup, BACKUP_NAG_DAYS } from '../export.js';
import { exportDialog } from '../export-ui.js';
import { readBackup, restoreBackup, currentCounts } from '../restore.js';
import { icon } from '../icons.js';

export default async function settings() {
  setTitle('設定');
  const wrap = el('div');

  // ---------- Gemini ----------
  const key = await getSetting('geminiApiKey', '');
  const tier = await getSetting('geminiTier', 'free');
  const model = await getSetting('geminiModel', DEFAULT_MODEL);

  const keyInput = input({ type: 'password', value: key, placeholder: 'AQ… 或 AIza…', autocomplete: 'off' });
  const modelSel = el('select', {});

  // 保留目前選的那個，就算它不在清單裡也一樣——不要在使用者沒察覺的情況下換掉他的模型
  function fillModels(list, selected) {
    const ids = list.map((m) => m.id);
    if (selected && !ids.includes(selected)) {
      list = [{ id: selected, label: '（目前設定，已不在可用清單中）' }, ...list];
    }
    modelSel.replaceChildren(...list.map((m) => el('option',
      { value: m.id, selected: m.id === selected },
      m.label ? `${m.id} — ${m.label}` : m.id)));
  }
  fillModels(FALLBACK_MODELS, model);

  const modelHint = el('div', { class: 'muted', style: 'margin-top:6px' }, '');

  const fetchModelsBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '抓取可用模型' });
  fetchModelsBtn.addEventListener('click', async () => {
    flushActiveInput();
    const k = keyInput.value.trim();
    if (!k) { toast('先貼上 API key'); return; }
    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = '查詢中…';
    try {
      const list = await listModels(k);
      if (!list.length) throw new Error('這把 key 沒有任何可用的文字模型');
      const keep = list.some((m) => m.id === modelSel.value) ? modelSel.value : list[0].id;
      fillModels(list, keep);
      modelHint.textContent = `你的 key 目前可以用 ${list.length} 個模型。`;
      toast(`抓到 ${list.length} 個，已選 ${keep}`, 4000);
    } catch (e) {
      toast(`查詢失敗：${e.message}`, 6000);
    } finally {
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = '抓取可用模型';
    }
  });

  // AQ. 是 Google 2026 年開始發的新格式，native endpoint 完全支援。
  // 只有那些寫死要 AIza 開頭的第三方工具會擋，這個 App 不會。
  const keyFormatNote = el('div', {});
  const checkKeyFormat = () => {
    const k = keyInput.value.trim();
    keyFormatNote.replaceChildren();
    if (!k || k.startsWith('AQ.') || k.startsWith('AQ') || k.startsWith('AIza')) return;
    keyFormatNote.append(el('div', { class: 'notice warn' },
      '這串不太像 API key（正常是 AQ. 或 AIza 開頭）。'));
  };
  keyInput.addEventListener('input', checkKeyFormat);
  checkKeyFormat();

  const tierWrap = el('div', { class: 'chips' });
  let curTier = tier;
  const tierBtns = [
    { v: 'free', label: '免費層' },
    { v: 'paid', label: '付費層（已加值／綁定帳單）' },
  ].map(({ v, label }) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(v === curTier), text: label });
    b.addEventListener('click', () => {
      curTier = v;
      for (const x of tierBtns) x.setAttribute('aria-pressed', String(x === b));
      tierNotice.replaceChildren(...tierNoticeContent(curTier));
    });
    return b;
  });
  tierWrap.append(...tierBtns);

  const tierNotice = el('div', {});
  tierNotice.replaceChildren(...tierNoticeContent(curTier));

  // 清除 key 必須是一個明確的動作，不能靠「把欄位清空再存檔」——
  // 那條路太容易在你沒察覺的時候被觸發。
  const clearKeyBtn = el('button', {
    class: 'btn ghost sm',
    type: 'button',
    text: '清除 key',
    style: 'color:var(--danger)',
  });
  clearKeyBtn.addEventListener('click', async () => {
    if (!keyInput.value.trim() && !await getSetting('geminiApiKey', '')) { toast('本來就沒有 key'); return; }
    if (!await confirmDialog({
      title: '清除已存的 API key？',
      body: '之後要用 AI 功能得重新貼一次。記錄與照片不受影響。',
      okLabel: '清除',
    })) return;
    keyInput.value = '';
    await setSetting('geminiApiKey', '');
    checkKeyFormat();
    renderKeyStatus();
    await refreshTierBadge();
    toast('已清除');
  });

  // 測試結果留在畫面上，不要用 toast——錯誤訊息通常很長，而且你會想照著它一步步弄
  const testResult = el('div', {});
  const testBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '測試連線' });
  testBtn.addEventListener('click', async () => {
    flushActiveInput();
    const k = keyInput.value.trim();
    if (!k) { toast('先貼上 API key'); return; }
    testBtn.disabled = true;
    testBtn.textContent = '測試中…';
    testResult.replaceChildren();
    try {
      const r = await testKey(k, modelSel.value);
      if (r.keyOk && r.modelOk) {
        testResult.append(el('div', { class: 'notice info' },
          `連線成功。這把 key 可以用 ${r.models} 個模型，「${modelSel.value}」正常。`));
      } else {
        testResult.append(el('div', { class: 'notice danger' }, [
          el('strong', { text: r.keyOk ? '模型有問題，key 沒事' : 'key 沒有通過驗證' }),
          el('div', { style: 'margin-bottom:6px' }, r.hint || ''),
          el('div', { class: 'muted' }, `Google 回的原文：${r.error}`),
        ]));
      }
    } catch (e) {
      testResult.append(el('div', { class: 'notice danger' }, `測試失敗：${e.message}`));
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '測試連線';
    }
  });

  // ---------- AI 總開關 ----------
  const aiEnabled = await getSetting('aiEnabled', true);
  const aiBox = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
  aiBox.checked = !!aiEnabled;

  // AI 關掉的時候，底下這些卡片全部收起來——它們全部只在送資料給 Gemini 時才有作用，
  // 留在畫面上只會讓人以為還有東西要設定。設定值本身不會被清掉。
  const aiOnlyCards = [];
  const addAiCard = (node) => {
    aiOnlyCards.push(node);
    wrap.append(node);
    return node;
  };
  const syncAiCards = () => {
    for (const c of aiOnlyCards) c.hidden = !aiBox.checked;
  };
  aiBox.addEventListener('change', syncAiCards);

  // AI 關掉時 Gemini 卡片會收起來，等於看不到 key 還在不在。
  // 在這裡給一行遮罩過的確認，免得使用者以為關掉開關就把 key 弄丟了。
  const keyStatus = el('div', { class: 'muted', style: 'margin-top:10px' });
  const renderKeyStatus = () => {
    const k = keyInput.value.trim();
    keyStatus.replaceChildren(k
      ? el('span', {}, `已存有 API key：${maskKey(k)}　關掉 AI 不會把它刪掉。`)
      : el('span', {}, '還沒存過 API key。'));
  };
  keyInput.addEventListener('input', renderKeyStatus);
  renderKeyStatus();

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '要不要用 AI' }),
    el('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, [
      aiBox,
      el('span', { text: '使用 Gemini' }),
    ]),
    keyStatus,
  ]));

  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: 'Gemini API' }),
    field('API Key', keyInput),
    keyFormatNote,
    el('label', { class: 'field' }, [
      el('span', { text: '模型' }),
      modelSel,
      modelHint,
    ]),
    el('label', { class: 'field' }, [el('span', { text: '方案' }), tierWrap]),
    tierNotice,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' }, [testBtn, fetchModelsBtn, clearKeyBtn]),
    testResult,
  ]));

  // ---------- 逐字稿來源 ----------
  // 這張卡整張只在決定「要不要把錄音送出去」，AI 關掉時剩下的選項只有鍵盤聽寫，沒得選
  const src = await getSetting('transcriptSource', 'dictation');
  let curSrc = src;
  const srcBtns = [
    { v: 'dictation', label: 'iOS 鍵盤聽寫（不上傳錄音）' },
    { v: 'gemini', label: 'Gemini 轉檔（會上傳錄音）' },
  ].map(({ v, label }) => {
    const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(v === curSrc), text: label });
    b.addEventListener('click', () => {
      curSrc = v;
      for (const x of srcBtns) x.setAttribute('aria-pressed', String(x === b));
    });
    return b;
  });

  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '逐字稿預設來源' }),
    el('div', { class: 'chips' }, srcBtns),
  ]));

  // ---------- 圖片 ----------
  const allowImg = await getSetting('allowImageUpload', false);
  const allowImgBox = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
  allowImgBox.checked = !!allowImg;
  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '圖片' }),
    el('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, [
      allowImgBox,
      el('span', { text: '允許我手動選單張照片送 AI' }),
    ]),
  ]));

  // ---------- 代號對照表 ----------
  const aliases = await getAliases();
  const aliasList = el('div');
  const renderAliases = () => {
    aliasList.replaceChildren();
    if (!aliases.length) {
      aliasList.append(el('p', { class: 'muted', text: '還沒有對照。' }));
    }
    aliases.forEach((a, i) => {
      const from = input({ value: a.from, placeholder: '真實名稱' });
      const to = input({ value: a.to, placeholder: '代號' });
      from.addEventListener('input', () => { a.from = from.value; });
      to.addEventListener('input', () => { a.to = to.value; });
      const rm = el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': '刪除這組對照' },
        [icon('close', { size: 16 })]);
      rm.addEventListener('click', () => { aliases.splice(i, 1); renderAliases(); });
      aliasList.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        from, el('span', { text: '→', class: 'muted' }), to, rm,
      ]));
    });
  };
  renderAliases();

  const addAlias = el('button', { class: 'btn ghost sm', type: 'button' }, [icon('plus', { size: 16 }), '新增一組']);
  addAlias.addEventListener('click', () => { aliases.push({ from: '', to: '' }); renderAliases(); });

  const fillFromProjects = el('button', { class: 'btn ghost sm', type: 'button', text: '從專案自動帶入' });
  fillFromProjects.addEventListener('click', async () => {
    let n = 0;
    for (const p of await listProjects()) {
      if (p.name && p.code && !aliases.some((a) => a.from === p.name)) {
        aliases.push({ from: p.name, to: p.code });
        n++;
      }
    }
    renderAliases();
    toast(n ? `帶入 ${n} 組` : '沒有新的可帶入（專案要先填代號）');
  });

  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '代號對照表' }),
    aliasList,
    el('div', { class: 'row wrap', style: 'gap:8px' }, [addAlias, fillFromProjects]),
  ]));

  // ---------- 敏感詞 ----------
  const extraSensitive = await getExtraSensitive();
  const sensInput = el('textarea', {
    placeholder: '一行一個',
    style: 'min-height:90px',
  });
  sensInput.value = extraSensitive.join('\n');
  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '敏感詞警示' }),
    sensInput,
  ]));

  syncAiCards(); // 進頁面時就要是對的狀態，不能等使用者去撥開關

  // ---------- 儲存 ----------
  const saveBtn = el('button', { class: 'btn block', text: '儲存設定' });
  saveBtn.addEventListener('click', async () => {
    flushActiveInput();
    await setSetting('aiEnabled', aiBox.checked);
    // 欄位空白時「不動」已存的 key。之前是無條件覆寫，等於只要在任何情況下
    // 欄位沒被填回值（頁面沒完整渲染、輸入法沒同步、瀏覽器清掉密碼欄…），
    // 按一下儲存就把 key 洗掉。要清除請按底下的「清除 key」。
    const typedKey = keyInput.value.trim();
    if (typedKey) await setSetting('geminiApiKey', typedKey);
    await setSetting('geminiTier', curTier);
    await setSetting('geminiModel', modelSel.value);
    await setSetting('transcriptSource', curSrc);
    await setSetting('allowImageUpload', allowImgBox.checked);
    await setAliases(aliases.filter((a) => a.from.trim() && a.to.trim()));
    await setExtraSensitive(sensInput.value.split('\n').map((s) => s.trim()).filter(Boolean));
    await refreshTierBadge();
    renderKeyStatus();
    toast('已儲存');
  });
  wrap.append(saveBtn);

  // ---------- 備份與空間 ----------
  const est = await storageEstimate();
  const { iso, days } = await getLastBackup();

  const backupBtn = el('button', { class: 'btn block', type: 'button', text: '匯出…' });
  backupBtn.addEventListener('click', () => exportDialog({ title: '全部資料' }));

  // 從備份 zip 還原。檔案選擇器不能用程式模擬點擊之外的方式叫出來，
  // 所以按鈕按下去就是去點這個藏起來的 input。
  const picker = el('input', {
    type: 'file',
    accept: '.zip,application/zip',
    style: 'display:none',
  });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    picker.value = ''; // 選同一個檔第二次也要能觸發
    if (file) await restoreDialog(file);
  });

  const restoreBtn = el('button', { class: 'btn ghost block', type: 'button', text: '從備份還原…', style: 'margin-top:10px' });
  restoreBtn.addEventListener('click', () => picker.click());

  const statusLine = !iso
    ? el('div', { class: 'notice warn' }, '還沒有備份過。')
    : el('p', { class: days >= BACKUP_NAG_DAYS ? '' : 'muted', style: 'margin:-4px 0 10px' },
      `上次備份：${iso.slice(0, 10)}（${days === 0 ? '今天' : `${days} 天前`}）`);

  wrap.append(el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', { text: '備份與匯出' }),
    statusLine,
    backupBtn,
    restoreBtn,
    picker,
    est ? el('p', { class: 'muted', style: 'margin-top:10px' },
      `已用 ${fmtBytes(est.usage)}　可用約 ${fmtBytes(est.quota)}`) : null,
    // 版本編號。修完一個 bug 之後要能一眼確認手機上跑的到底是不是新版，
    // 不然「還是壞的」跟「還沒更新到」分不出來。
    await versionLine(),
    await persistenceNotice(),
  ]));

  const wipe = el('button', {
    class: 'btn ghost block',
    type: 'button',
    text: '清空所有資料',
    style: 'color:var(--danger)',
  });
  wipe.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空所有資料？',
      body: '所有專案、記錄、照片、錄音都會被刪除，沒辦法復原。請先確認你已經匯出備份。',
      okLabel: '全部刪除',
    });
    if (!ok) return;
    indexedDB.deleteDatabase('site-log');
    toast('已清空，重新載入中…');
    setTimeout(() => location.reload(), 900);
  });
  wrap.append(wipe);

  return wrap;
}

/** 目前這台裝置上跑的是哪一版。版號就是 sw.js 的 CACHE 名稱，不用另外維護。 */
async function versionLine() {
  const keys = await caches?.keys?.().catch(() => []) ?? [];
  const cur = keys.find((k) => k.startsWith('site-log-'));
  if (!cur) return null; // 沒有 service worker（例如直接開檔案）就不要顯示
  return el('p', { class: 'muted', style: 'margin-top:4px' }, `版本 ${cur.replace('site-log-', '')}`);
}

/**
 * 選好備份檔之後：先讀出來給他看清楚是哪一包，再讓他決定合併還是取代。
 * 讀取階段不會動到任何資料，看了不對可以直接關掉。
 */
async function restoreDialog(file) {
  const dlg = el('dialog');
  const status = el('div', { class: 'muted', style: 'min-height:1.5em' }, '讀取中…');
  const close = el('button', { class: 'btn ghost', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());
  const body = el('div');

  dlg.append(el('div', {}, [
    el('h2', { text: '從備份還原' }),
    body,
    status,
    el('menu', {}, [close]),
  ]));
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove(), { once: true });

  let backup;
  try {
    backup = await readBackup(file);
  } catch (err) {
    status.textContent = '';
    body.append(el('div', { class: 'notice warn' }, err.message));
    return;
  }

  const now = await currentCounts();
  status.textContent = '';
  // 用 ui.js 的 append：最後那個條件式可能是 null，原生 append 會把它印成 "null"
  append(body,
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' }, [
      `${file.name}`,
      backup.exportedAt ? `　匯出於 ${backup.exportedAt.slice(0, 10)}` : '',
    ].join('')),
    el('p', { style: 'margin:0 0 4px' },
      `備份裡：${backup.projects.length} 個專案、${backup.entries.length} 筆記錄、${backup.media.length} 個檔案`),
    el('p', { class: 'muted', style: 'margin:0 0 12px' },
      `目前裝置上：${now.projects} 個專案、${now.entries} 筆記錄、${now.media} 個檔案`),
    backup.missingMedia
      ? el('div', { class: 'notice warn' }, `有 ${backup.missingMedia} 個檔案在 zip 裡找不到，那幾張照片或錄音救不回來。`)
      : null,
  );

  const run = async (mode) => {
    body.replaceChildren();
    for (const b of [mergeBtn, replaceBtn]) b.disabled = true;
    close.disabled = true;
    try {
      const r = await restoreBackup(backup, mode, (t) => { status.textContent = t; });
      if (r.failed?.length) {
        // 有東西沒進去就要講清楚是哪些、為什麼，不能只說「完成」
        close.disabled = false;
        status.textContent = '';
        append(body,
          el('div', { class: 'notice warn' }, [
            el('strong', { text: `${r.failed.length} 個檔案還原失敗` }),
            el('div', {}, `其餘 ${r.media} 個檔案與所有文字資料已經進去了。`),
            el('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' },
              r.failed.slice(0, 3).map((f) => `${f.path.split('/').pop()}：${f.reason}`).join('\n')),
          ]),
          el('div', { class: 'muted', style: 'margin-top:8px' }, '重新載入後就會看到已經還原的部分。'));
        setTimeout(() => location.reload(), 6000);
        return;
      }
      status.textContent = `完成：${r.projects} 個專案、${r.entries} 筆記錄、${r.media} 個檔案。重新載入中…`;
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      close.disabled = false;
      status.textContent = '';
      body.append(el('div', { class: 'notice warn' }, `還原失敗：${err.message}`));
    }
  };

  const mergeBtn = el('button', { class: 'btn block', type: 'button', text: '合併匯入（保留現有資料）' });
  mergeBtn.addEventListener('click', () => run('merge'));

  const replaceBtn = el('button', {
    class: 'btn ghost block',
    type: 'button',
    text: '完全取代（先清空再匯入）',
    style: 'margin-top:10px;color:var(--danger)',
  });
  replaceBtn.addEventListener('click', async () => {
    // 這是全 App 唯一一個「按下去就把現有資料刪光」的匯入路徑，一定要再問一次
    const ok = await confirmDialog({
      title: '清空現在的資料再匯入？',
      body: `目前的 ${now.projects} 個專案、${now.entries} 筆記錄、${now.media} 個檔案會先被刪掉，換成這包備份的內容。沒辦法復原。`,
      okLabel: '清空並匯入',
    });
    if (ok) run('replace');
  });

  append(body, mergeBtn, replaceBtn);
}

/**
 * 讓使用者看得到瀏覽器到底有沒有答應幫他留著資料。
 * 沒答應的話，iOS 在空間不足或長期沒開時就可能把整個資料庫清掉。
 */
async function persistenceNotice() {
  const p = await isPersisted();
  if (p === true) {
    return el('p', { class: 'muted', style: 'margin-top:6px' }, '儲存狀態：持久化已生效');
  }
  if (p === false) {
    return el('div', { class: 'notice warn', style: 'margin-top:10px' }, [
      el('strong', { text: '儲存狀態：未取得持久化' }),
      '資料可能被系統清掉。加到主畫面通常就會拿到。',
    ]);
  }
  return null; // 這個瀏覽器沒有這個 API，不要亂講
}

/** 只露頭尾，足夠讓你認出是不是同一把，但不會整串顯示在螢幕上。 */
function maskKey(k) {
  if (k.length <= 10) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 5)}…${k.slice(-4)}`;
}

function tierNoticeContent(tier) {
  if (tier === 'paid') {
    return [el('div', { class: 'notice info' }, '付費層：Google 不會拿內容去訓練模型。')];
  }
  return [el('div', { class: 'notice warn' },
    '免費層：內容可能被 Google 用於改善產品，也可能被人工審閱。')];
}
