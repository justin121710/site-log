// 設定：Gemini key／方案、逐字稿預設來源、代號對照表、敏感詞、儲存空間、備份。

import { el, setTitle, field, input, toast, fmtBytes, confirmDialog, flushActiveInput } from '../ui.js';
import { getSetting, setSetting, storageEstimate, listProjects } from '../db.js';
import { refreshTierBadge } from '../app.js';
import { DEFAULT_MODEL, FALLBACK_MODELS, testKey, listModels } from '../gemini.js';
import { getAliases, setAliases, getExtraSensitive, setExtraSensitive } from '../redact.js';
import { getLastBackup, BACKUP_NAG_DAYS } from '../export.js';
import { exportDialog } from '../export-ui.js';
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

  const modelHint = el('div', { class: 'muted', style: 'margin-top:6px' },
    'Google 換模型的速度比這個 App 改版快。跳出「模型用不了」就按下面這顆重抓。');

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
      '這串不太像 Gemini API key（正常是 AQ. 或 AIza 開頭）。'
      + '確認你複製的是 Google AI Studio 的 API key，不是專案 ID 或 OAuth token。'));
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

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '要不要用 AI' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '關掉之後所有 AI 按鈕都會消失，這個 App 就是一個純手動的工地記錄本——'
      + '拍照、錄音、鍵盤聽寫、分類、經驗庫、浮水印、日報分段、匯出備份全部照常。'
      + '以前整理過的內容不會消失，只是不能再產生新的。'),
    el('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, [
      aiBox,
      el('span', { text: '使用 Gemini（需要 API key 與額度）' }),
    ]),
  ]));

  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: 'Gemini API' }),
    field('API Key', keyInput, 'key 只存在這台裝置的瀏覽器裡，不會進 GitHub、不會傳給我。'),
    keyFormatNote,
    el('label', { class: 'field' }, [
      el('span', { text: '模型' }),
      modelSel,
      modelHint,
    ]),
    el('label', { class: 'field' }, [el('span', { text: '方案' }), tierWrap]),
    tierNotice,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' }, [testBtn, fetchModelsBtn]),
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
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '這只是預設值，每一筆記錄都還是可以當場改。錄音檔本身永遠留在裝置上，'
      + '只有你選 Gemini 轉檔時才會上傳那一段音訊。'),
    el('div', { class: 'chips' }, srcBtns),
  ]));

  // ---------- 圖片 ----------
  const allowImg = await getSetting('allowImageUpload', false);
  const allowImgBox = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
  allowImgBox.checked = !!allowImg;
  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '圖片' }),
    el('div', { class: 'notice info' },
      '照片預設永遠不會上傳。打開下面這個開關之後，你才能在單一張照片上手動點「問 AI」，'
      + '而且每次送出前都會再問你一次。'),
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
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '送 AI 之前，左邊的字會自動換成右邊的代號。'
      + '這張表本身永遠不會上傳，顯示的時候會換回真名。'),
    aliasList,
    el('div', { class: 'row wrap', style: 'gap:8px' }, [addAlias, fillFromProjects]),
  ]));

  // ---------- 敏感詞 ----------
  const extraSensitive = await getExtraSensitive();
  const sensInput = el('textarea', {
    placeholder: '一行一個。例：\n王主任\n○○營造\n標案編號',
    style: 'min-height:90px',
  });
  sensInput.value = extraSensitive.join('\n');
  addAiCard(el('div', { class: 'card' }, [
    el('h2', { text: '敏感詞警示' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '送出前會掃描要傳出去的文字，命中就標紅提醒你。專案名稱、機關、承商會自動納入，'
      + '這裡只需要補其他的。'),
    sensInput,
  ]));

  syncAiCards(); // 進頁面時就要是對的狀態，不能等使用者去撥開關

  // ---------- 儲存 ----------
  const saveBtn = el('button', { class: 'btn block', text: '儲存設定' });
  saveBtn.addEventListener('click', async () => {
    flushActiveInput();
    await setSetting('aiEnabled', aiBox.checked);
    await setSetting('geminiApiKey', keyInput.value.trim());
    await setSetting('geminiTier', curTier);
    await setSetting('geminiModel', modelSel.value);
    await setSetting('transcriptSource', curSrc);
    await setSetting('allowImageUpload', allowImgBox.checked);
    await setAliases(aliases.filter((a) => a.from.trim() && a.to.trim()));
    await setExtraSensitive(sensInput.value.split('\n').map((s) => s.trim()).filter(Boolean));
    await refreshTierBadge();
    toast('已儲存');
  });
  wrap.append(saveBtn);

  // ---------- 備份與空間 ----------
  const est = await storageEstimate();
  const { iso, days } = await getLastBackup();

  const backupBtn = el('button', { class: 'btn block', type: 'button', text: '匯出…' });
  backupBtn.addEventListener('click', () => exportDialog({ title: '全部資料' }));

  const statusLine = !iso
    ? el('div', { class: 'notice warn' }, '還沒有備份過。')
    : el('p', { class: days >= BACKUP_NAG_DAYS ? '' : 'muted', style: 'margin:-4px 0 10px' },
      `上次備份：${iso.slice(0, 10)}（${days === 0 ? '今天' : `${days} 天前`}）`);

  wrap.append(el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', { text: '備份與匯出' }),
    statusLine,
    el('p', { class: 'muted', style: 'margin:0 0 10px' },
      '匯出後用 iOS 的分享選單存到「檔案」或 iCloud。'
      + '瀏覽器的儲存空間有可能被系統清掉，照片與錄音只在這台裝置上，重做不回來。'),
    backupBtn,
    est ? el('p', { class: 'muted', style: 'margin-top:10px' },
      `已用 ${fmtBytes(est.usage)}　可用約 ${fmtBytes(est.quota)}`) : null,
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

function tierNoticeContent(tier) {
  if (tier === 'paid') {
    return [el('div', { class: 'notice info' },
      '付費層：Google 不會拿你送出的內容去訓練模型。')];
  }
  return [el('div', { class: 'notice warn' }, [
    el('strong', { text: '免費層：內容可能被用於改善 Google 的產品，也可能被人工審閱。' }),
    '拿公開資料練習沒問題。正式工作內容請先綁信用卡切到付費層，並確認公司的規定。',
  ])];
}
