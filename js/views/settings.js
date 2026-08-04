// 設定：Gemini key／方案、逐字稿預設來源、代號對照表、敏感詞、儲存空間、備份。

import { el, setTitle, field, input, toast, fmtBytes, confirmDialog, flushActiveInput } from '../ui.js';
import { getSetting, setSetting, storageEstimate, listProjects } from '../db.js';
import { refreshTierBadge } from '../app.js';
import { DEFAULT_MODEL, MODELS, testKey } from '../gemini.js';
import { getAliases, setAliases, getExtraSensitive, setExtraSensitive } from '../redact.js';
import { exportBackup } from '../export.js';

export default async function settings() {
  setTitle('設定');
  const wrap = el('div');

  // ---------- Gemini ----------
  const key = await getSetting('geminiApiKey', '');
  const tier = await getSetting('geminiTier', 'free');
  const model = await getSetting('geminiModel', DEFAULT_MODEL);

  const keyInput = input({ type: 'password', value: key, placeholder: 'AIza…', autocomplete: 'off' });
  const modelSel = el('select', {},
    MODELS.map((m) => el('option', { value: m.id, selected: m.id === model }, m.label)));

  const tierWrap = el('div', { class: 'chips' });
  let curTier = tier;
  const tierBtns = [
    { v: 'free', label: '免費層' },
    { v: 'paid', label: '付費層（已綁信用卡）' },
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

  const testBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '測試連線' });
  testBtn.addEventListener('click', async () => {
    flushActiveInput();
    const k = keyInput.value.trim();
    if (!k) { toast('先貼上 API key'); return; }
    testBtn.disabled = true;
    testBtn.textContent = '測試中…';
    try {
      await testKey(k, modelSel.value);
      toast('連線成功');
    } catch (e) {
      toast(`失敗：${e.message}`, 5000);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '測試連線';
    }
  });

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: 'Gemini API' }),
    field('API Key', keyInput, 'key 只存在這台裝置的瀏覽器裡，不會進 GitHub、不會傳給我。'),
    field('模型', modelSel),
    el('label', { class: 'field' }, [el('span', { text: '方案' }), tierWrap]),
    tierNotice,
    el('div', { class: 'row', style: 'margin-top:10px' }, [testBtn]),
  ]));

  // ---------- 逐字稿來源 ----------
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

  wrap.append(el('div', { class: 'card' }, [
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
  wrap.append(el('div', { class: 'card' }, [
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
      const rm = el('button', { class: 'btn ghost sm', type: 'button', text: '✕' });
      rm.addEventListener('click', () => { aliases.splice(i, 1); renderAliases(); });
      aliasList.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        from, el('span', { text: '→', class: 'muted' }), to, rm,
      ]));
    });
  };
  renderAliases();

  const addAlias = el('button', { class: 'btn ghost sm', type: 'button', text: '＋ 新增一組' });
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

  wrap.append(el('div', { class: 'card' }, [
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
  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '敏感詞警示' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '送出前會掃描要傳出去的文字，命中就標紅提醒你。專案名稱、機關、承商會自動納入，'
      + '這裡只需要補其他的。'),
    sensInput,
  ]));

  // ---------- 儲存 ----------
  const saveBtn = el('button', { class: 'btn block', text: '儲存設定' });
  saveBtn.addEventListener('click', async () => {
    flushActiveInput();
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
  const backupBtn = el('button', { class: 'btn ghost block', type: 'button', text: '匯出備份（.zip）' });
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true;
    backupBtn.textContent = '打包中…';
    try {
      await exportBackup();
    } catch (e) {
      toast(`匯出失敗：${e.message}`, 5000);
    } finally {
      backupBtn.disabled = false;
      backupBtn.textContent = '匯出備份（.zip）';
    }
  });

  wrap.append(el('div', { class: 'card', style: 'margin-top:16px' }, [
    el('h2', { text: '備份' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '匯出後用 iOS 的分享選單存到「檔案」或雲端硬碟。'
      + '瀏覽器的儲存空間有可能被系統清掉，請定期匯出。'),
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
