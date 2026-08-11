// 一筆記錄的編輯畫面。這是整個 App 使用頻率最高的一頁，所以按鈕都做大。
//
// 資料流：拍照／錄音 → 逐字稿（預設 iOS 鍵盤聽寫）→ 你按「AI 整理」才會有文字離開裝置。

import {
  el, setTitle, field, input, toast, confirmDialog, fmtDate, fmtTime,
  fmtDuration, today, debounce, flushActiveInput,
} from '../ui.js';
import {
  get, getSetting, newEntry, saveEntry, deleteEntry, addMedia, listMedia,
  deleteMedia, setSetting, listProjects,
} from '../db.js';
import { CATEGORIES, categoryName, seedSubtags } from '../taxonomy.js';
import {
  pickPhotos, normalizePhoto, getGPS, Recorder, isRecordingSupported,
  pickAudio, audioDuration,
} from '../media.js';
import { confirmUpload, confirmAudioUpload } from '../confirm-upload.js';
import { icon } from '../icons.js';
import { tidyAndExtract, transcribe, describeImage } from '../gemini.js';
import { fixTerms } from '../glossary.js';
import { applyWatermark } from '../watermark.js';

export default async function entryView(params) {
  const isNew = !params.entryId;
  const query = new URLSearchParams(location.hash.split('?')[1] || '');

  const e = isNew
    ? newEntry(params.projectId, query.get('date') || today())
    : await get('entries', params.entryId);
  if (!e) throw new Error('找不到這筆記錄');

  // 從經驗庫直接建的記錄沒有專案，這是刻意允許的，不能當成錯誤。
  let project = e.projectId ? await get('projects', e.projectId) : null;

  setTitle(isNew ? '新增記錄' : fmtDate(e.date));

  // 新記錄先寫進 DB，這樣照片與錄音才有 entryId 可以掛。
  if (isNew) {
    await saveEntry(e);
    history.replaceState(null, '', `#/e/${e.id}`);
    getGPS().then((gps) => { if (gps && !e.gps) { e.gps = gps; saveEntry(e); } });
  }

  const wrap = el('div');
  const autosave = debounce(() => saveEntry(e), 700);
  const subtagTable = await getSetting('subtags', seedSubtags());

  // ---------- 照片 ----------
  const thumbs = el('div', { class: 'thumbs' });
  const aiOn = await getSetting('aiEnabled', true);
  const allowImageUpload = aiOn && await getSetting('allowImageUpload', false);

  async function renderMedia() {
    const media = await listMedia(e.id);
    thumbs.replaceChildren();

    for (const m of media.filter((x) => x.kind === 'photo')) {
      const url = URL.createObjectURL(m.blob);
      const box = el('div', { class: 'thumb' }, [
        el('img', { src: url, alt: '現場照片' }),
        el('button', {
          class: 'rm',
          type: 'button',
          'aria-label': '刪除這張照片',
          onclick: async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!await confirmDialog({ title: '刪除這張照片？', body: '刪掉就找不回來了。', okLabel: '刪除' })) return;
            await deleteMedia(m.id);
            URL.revokeObjectURL(url);
            renderMedia();
          },
        }, [icon('close', { size: 16 })]),
      ]);
      box.addEventListener('click', () => openPhoto(m, e, project, allowImageUpload));
      thumbs.append(box);
    }

    audioList.replaceChildren();
    for (const m of media.filter((x) => x.kind === 'audio')) {
      audioList.append(audioRow(m, e, autosave, transcriptBox, renderMedia, aiOn));
    }
  }

  const shootBtn = el('button', { class: 'btn', type: 'button' }, [icon('camera'), '拍照']);
  shootBtn.addEventListener('click', () => addPhotos({ camera: true }));
  const albumBtn = el('button', { class: 'btn ghost', type: 'button' }, [icon('image'), '從相簿選']);
  albumBtn.addEventListener('click', () => addPhotos({ camera: false, multiple: true }));

  async function addPhotos(opts) {
    const files = await pickPhotos(opts);
    if (!files.length) return;
    toast(`處理 ${files.length} 張照片…`, 1500);
    for (const f of files) {
      const { blob, width, height } = await normalizePhoto(f);
      await addMedia({ entryId: e.id, kind: 'photo', blob, mime: blob.type, width, height });
    }
    if (!e.gps) getGPS().then((g) => { if (g) { e.gps = g; saveEntry(e); } });
    await renderMedia();
    toast('照片已存在這台裝置上');
  }

  wrap.append(el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('h2', { text: '照片', style: 'margin:0' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted mono', text: fmtTime(e.capturedAt) }),
    ]),
    el('p', { class: 'muted', style: 'margin:6px 0 10px' }, '照片只存在這台裝置，不會上傳。'),
    el('div', { class: 'row', style: 'gap:8px;margin-bottom:10px' }, [shootBtn, albumBtn]),
    thumbs,
  ]));

  // ---------- 錄音與逐字稿 ----------
  const audioList = el('div');
  const recStatus = el('span', { class: 'muted' });
  const recBtn = el('button', { class: 'btn', type: 'button' }, [icon('mic'), '開始錄音']);
  const setRecLabel = (recording) => {
    recBtn.replaceChildren(icon(recording ? 'stop' : 'mic'), recording ? '停止' : '開始錄音');
    recBtn.classList.toggle('danger', recording);
  };
  const recorder = new Recorder({
    onTick: (s) => { recStatus.replaceChildren(el('span', { class: 'rec-dot' }), ` 錄音中 ${fmtDuration(s)}`); },
  });

  recBtn.addEventListener('click', async () => {
    if (recorder.recording) {
      const out = await recorder.stop();
      setRecLabel(false);
      recStatus.textContent = '';
      if (!out) { toast('沒有錄到聲音'); return; }
      const dur = out.duration || await audioDuration(out.blob);
      await addMedia({ entryId: e.id, kind: 'audio', blob: out.blob, mime: out.mime, duration: dur });
      await renderMedia();
      toast('錄音已存在這台裝置上');
      return;
    }
    try {
      await recorder.start();
      setRecLabel(true);
    } catch (err) {
      toast(err.message, 4000);
    }
  });

  const importBtn = el('button', { class: 'btn ghost', type: 'button' }, [icon('importFile'), '匯入音檔']);
  importBtn.addEventListener('click', async () => {
    const [f] = await pickAudio();
    if (!f) return;
    const dur = await audioDuration(f);
    await addMedia({ entryId: e.id, kind: 'audio', blob: f, mime: f.type, duration: dur });
    await renderMedia();
    toast('已匯入');
  });

  const audioCard = el('div', { class: 'card' }, [
    el('h2', { text: '錄音' }),
    el('div', { class: 'notice info' },
      'iOS 上螢幕一鎖或切到別的 App，錄音就會中斷。請讓螢幕開著，講完就按停止。'
      + '長時間口述建議用 iOS 語音備忘錄錄好再匯入。'),
    isRecordingSupported()
      ? el('div', { class: 'row', style: 'gap:8px;margin-bottom:8px' }, [recBtn, importBtn, recStatus])
      : el('div', { class: 'row', style: 'gap:8px;margin-bottom:8px' }, [
        importBtn,
        el('span', { class: 'muted', text: '這個瀏覽器不支援直接錄音' }),
      ]),
    audioList,
  ]);
  wrap.append(audioCard);

  // ---------- 逐字稿 ----------
  const transcriptBox = el('textarea', {
    placeholder: '按鍵盤上的麥克風鍵直接講，或自己打。\n例：地下二樓 X3 到 Y5 那根柱子的主筋續接，續接位置看起來太集中。',
  });
  transcriptBox.value = e.transcript || '';
  transcriptBox.addEventListener('input', () => {
    e.transcript = transcriptBox.value;
    if (!e.transcriptSource) e.transcriptSource = 'dictation';
    autosave();
  });

  const fixBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '修正工程術語錯字' });
  fixBtn.addEventListener('click', () => {
    flushActiveInput();
    const { text, changes } = fixTerms(transcriptBox.value);
    if (!changes.length) { toast('沒有找到要修的錯字'); return; }
    transcriptBox.value = text;
    e.transcript = text;
    saveEntry(e);
    toast(`修正 ${changes.length} 處：${changes.join('、')}`, 4000);
  });

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '逐字稿' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '點進文字框後按鍵盤上的麥克風鍵，講的話會直接變成字，不經過這個 App 的網路。'),
    transcriptBox,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:8px' }, [fixBtn]),
  ]));

  // ---------- AI 整理 ----------
  const aiBox = el('div');
  function renderAI() {
    aiBox.replaceChildren();
    if (!e.ai) return;
    const block = el('div', { class: `ai-block ${e.verified ? 'verified' : ''}` }, [
      el('div', { class: 'row', style: 'margin-bottom:6px' }, [
        el('span', {
          class: `badge ${e.verified ? 'badge-verified' : 'badge-unverified'}`,
          text: e.verified ? '已確認' : '未查證',
        }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted', text: e.ai.model || '' }),
      ]),
      el('div', { style: 'white-space:pre-wrap', text: e.ai.tidied || '' }),
    ]);
    aiBox.append(block);

    const chk = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
    chk.checked = !!e.verified;
    chk.addEventListener('change', () => {
      e.verified = chk.checked;
      saveEntry(e);
      renderAI();
      toast(e.verified ? '已標記為確認過' : '改回未查證');
    });

    const noteInput = input({ value: e.verifiedNote || '', placeholder: '依據：規範章節／圖說編號／誰說的' });
    noteInput.addEventListener('input', () => { e.verifiedNote = noteInput.value; autosave(); });

    aiBox.append(
      el('label', { class: 'row', style: 'gap:10px;margin-top:10px;cursor:pointer' }, [
        chk,
        el('span', { text: '我已經問過前輩／查過規範，這段內容沒問題' }),
      ]),
      el('div', { style: 'margin-top:8px' }, [noteInput]),
    );
  }
  renderAI();

  const aiBtn = el('button', { class: 'btn ghost', type: 'button' }, [icon('sparkle'), '請 AI 整理並填欄位']);
  const setAiLabel = (busy) => {
    aiBtn.replaceChildren(icon('sparkle'), busy ? '整理中…' : '請 AI 整理並填欄位');
  };
  aiBtn.addEventListener('click', async () => {
    flushActiveInput();
    const raw = transcriptBox.value.trim();
    if (!raw) { toast('先有逐字稿才有東西可以整理'); return; }
    const toSend = await confirmUpload(raw, {
      title: '要送這段文字給 Gemini 嗎？',
      extraNote: 'AI 只會修錯字、整理通順、抽出樓層／軸線／分類。'
        + '它被明確禁止補充任何你沒說的工程見解或規範條號。',
    });
    if (toSend === null) return;

    aiBtn.disabled = true;
    setAiLabel(true);
    try {
      const out = await tidyAndExtract(toSend);
      e.ai = { ...out, model: await getSetting('geminiModel', ''), at: new Date().toISOString() };
      e.verified = false;
      if (out.floor && !e.floor) { e.floor = out.floor; fields.floor.value = out.floor; }
      if (out.gridline && !e.gridline) { e.gridline = out.gridline; fields.gridline.value = out.gridline; }
      if (out.area && !e.area) { e.area = out.area; fields.area.value = out.area; }
      const valid = out.categoryIds.filter((c) => CATEGORIES.some((x) => x.id === c));
      for (const c of valid) if (!e.categoryIds.includes(c)) e.categoryIds.push(c);
      for (const s of out.subtags) if (!e.subtags.includes(s)) e.subtags.push(s);
      await saveEntry(e);
      renderAI();
      renderCats();
      toast('整理好了。內容標示為「未查證」，確認過再勾。', 4000);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      aiBtn.disabled = false;
      setAiLabel(false);
    }
  });

  if (aiOn || e.ai) {
    wrap.append(el('div', { class: 'card' }, [
      el('h2', { text: 'AI 整理' }),
      // 關掉 AI 之後仍然要看得到以前整理過的內容，只是不能再產生新的
      aiOn ? el('div', { class: 'row', style: 'margin-bottom:10px' }, [aiBtn]) : null,
      aiBox,
    ]));
  }

  // ---------- 位置與分類 ----------
  const fields = {};
  const mkField = (key, label, ph) => {
    fields[key] = input({ value: e[key] ?? '', placeholder: ph });
    fields[key].addEventListener('input', () => { e[key] = fields[key].value; autosave(); });
    return field(label, fields[key]);
  };

  const catChips = el('div', { class: 'chips' });
  const subChips = el('div', {});

  function renderCats() {
    catChips.replaceChildren();
    for (const c of CATEGORIES) {
      const on = e.categoryIds.includes(c.id);
      const b = el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(on),
      }, [icon(c.icon, { size: 17 }), c.name]);
      b.addEventListener('click', () => {
        const i = e.categoryIds.indexOf(c.id);
        if (i >= 0) e.categoryIds.splice(i, 1);
        else e.categoryIds.push(c.id);
        saveEntry(e);
        renderCats();
      });
      catChips.append(b);
    }

    subChips.replaceChildren();
    const active = CATEGORIES.filter((c) => e.categoryIds.includes(c.id));
    if (!active.length) {
      subChips.append(el('p', { class: 'muted', text: '先選一個分類，子項才會出現。' }));
    }
    for (const c of active) {
      const list = subtagTable[c.id] || [];
      const row = el('div', { style: 'margin-bottom:10px' }, [
        el('div', { class: 'row muted', style: 'gap:5px;margin-bottom:5px' },
          [icon(c.icon, { size: 15 }), c.name]),
      ]);
      const chips = el('div', { class: 'chips' });
      for (const s of list) {
        const on = e.subtags.includes(s);
        const b = el('button', { class: 'chip sm', type: 'button', 'aria-pressed': String(on), text: s });
        b.addEventListener('click', () => {
          const i = e.subtags.indexOf(s);
          if (i >= 0) e.subtags.splice(i, 1);
          else e.subtags.push(s);
          saveEntry(e);
          renderCats();
        });
        chips.append(b);
      }
      const add = el('button', { class: 'chip sm', type: 'button' }, [icon('plus', { size: 15 }), '自訂']);
      add.addEventListener('click', async () => {
        const name = prompt(`在「${c.name}」底下新增子項：`);
        const v = (name || '').trim();
        if (!v) return;
        if (!subtagTable[c.id]) subtagTable[c.id] = [];
        if (!subtagTable[c.id].includes(v)) subtagTable[c.id].push(v);
        await setSetting('subtags', subtagTable);
        if (!e.subtags.includes(v)) e.subtags.push(v);
        await saveEntry(e);
        renderCats();
      });
      chips.append(add);
      row.append(chips);

      // AI 抽出來但不在清單裡的子項，也讓它顯示成已選中
      const extras = e.subtags.filter((s) => !Object.values(subtagTable).flat().includes(s));
      if (extras.length && c === active[0]) {
        row.append(el('div', { class: 'muted', style: 'margin-top:6px' }, `其他：${extras.join('、')}`));
      }
      subChips.append(row);
    }
  }
  renderCats();

  // ---------- 歸屬專案 ----------
  const projectSel = el('select');
  projectSel.append(el('option', { value: '' }, '未歸專案（只進經驗庫）'));
  for (const p of await listProjects()) {
    projectSel.append(el('option', { value: p.id, selected: p.id === e.projectId },
      p.name || '（未命名專案）'));
  }
  projectSel.addEventListener('change', async () => {
    e.projectId = projectSel.value || null;
    project = e.projectId ? await get('projects', e.projectId) : null;
    await saveEntry(e);
    toast(e.projectId ? '已掛到這個專案，會進它的日報' : '已改成未歸專案，不會進任何日報');
  });

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '歸屬專案' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      '沒有專案也可以記——它一樣會出現在經驗庫，只是不會被算進任何一天的監造日報。'
      + '之後想掛到某個案子，隨時在這裡改。'),
    projectSel,
  ]));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '位置' }),
    el('div', { class: 'grid2' }, [
      mkField('floor', '樓層', 'B2F'),
      mkField('gridline', '軸線／編號', 'X3-Y5'),
    ]),
    mkField('area', '區域／部位', '東側偽柱'),
    e.gps
      ? el('p', { class: 'muted mono' }, `GPS ${e.gps.lat}, ${e.gps.lng}（±${e.gps.acc}m）`)
      : el('p', { class: 'muted' }, 'GPS 沒抓到（地下室很正常）'),
  ]));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '分類' }),
    catChips,
    el('h3', { text: '子項' }),
    subChips,
  ]));

  // ---------- 備註 ----------
  const noteBox = el('textarea', { placeholder: '自己補充的文字（不會送給 AI，除非你在上面按整理）', style: 'min-height:90px' });
  noteBox.value = e.note || '';
  noteBox.addEventListener('input', () => { e.note = noteBox.value; autosave(); });
  wrap.append(el('div', { class: 'card' }, [el('h2', { text: '備註' }), noteBox]));

  // ---------- 底部 ----------
  /** 回到來的地方：有專案就回那天，沒有就回經驗庫的分類頁。 */
  const backTarget = () => {
    if (e.projectId) return `#/p/${e.projectId}/day/${e.date}`;
    return e.categoryIds.length ? `#/lib/${e.categoryIds[0]}` : '#/lib';
  };

  const done = el('button', { class: 'btn block', type: 'button', text: '完成' });
  done.addEventListener('click', async () => {
    flushActiveInput();
    if (recorder.recording) { toast('還在錄音，先按停止'); return; }
    await saveEntry(e);
    location.hash = backTarget();
  });
  wrap.append(done);

  const rm = el('button', {
    class: 'btn ghost block',
    type: 'button',
    text: '刪除這筆記錄',
    style: 'margin-top:10px;color:var(--danger)',
  });
  rm.addEventListener('click', async () => {
    if (!await confirmDialog({
      title: '刪除這筆記錄？',
      body: '照片、錄音、逐字稿都會一起刪掉，沒辦法復原。',
      okLabel: '刪除',
    })) return;
    recorder.cancel();
    const target = backTarget();
    await deleteEntry(e.id);
    toast('已刪除');
    location.hash = target;
  });
  wrap.append(rm);

  await renderMedia();
  window.addEventListener('hashchange', () => recorder.cancel(), { once: true });

  return wrap;
}

// ---------- 錄音列 ----------

function audioRow(m, e, autosave, transcriptBox, refresh, aiEnabled = true) {
  const url = URL.createObjectURL(m.blob);
  const player = el('audio', { controls: '', src: url, preload: 'metadata' });

  const toText = el('button', { class: 'btn ghost sm', type: 'button', text: '送 Gemini 轉逐字稿' });
  toText.addEventListener('click', async () => {
    const extra = await confirmAudioUpload(m.duration || 0);
    if (extra === null) return;
    toText.disabled = true;
    toText.textContent = '轉檔中…';
    try {
      const text = await transcribe(m.blob);
      const merged = [transcriptBox.value.trim(), text.trim()].filter(Boolean).join('\n');
      transcriptBox.value = merged;
      e.transcript = merged;
      e.transcriptSource = 'gemini';
      autosave();
      toast('逐字稿好了，請自己核對一遍');
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      toText.disabled = false;
      toText.textContent = '送 Gemini 轉逐字稿';
    }
  });

  const rm = el('button', { class: 'btn ghost sm', type: 'button', text: '刪除' });
  rm.addEventListener('click', async () => {
    if (!await confirmDialog({ title: '刪除這段錄音？', body: '刪掉就找不回來了。', okLabel: '刪除' })) return;
    await deleteMedia(m.id);
    URL.revokeObjectURL(url);
    refresh();
  });

  return el('div', { style: 'margin-bottom:12px' }, [
    el('div', { class: 'row muted', style: 'gap:5px' }, [
      icon('waveform', { size: 16 }),
      `${fmtDuration(m.duration)}　${(m.size / 1024).toFixed(0)} KB`,
    ]),
    player,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:6px' }, [aiEnabled ? toText : null, rm]),
  ]);
}

// ---------- 放大看照片 ----------

async function openPhoto(m, entry, project, allowImageUpload) {
  const dlg = el('dialog');
  const url = URL.createObjectURL(m.blob);
  const img = el('img', { src: url, style: 'width:100%;border-radius:10px;display:block' });

  const wmBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '疊上浮水印預覽' });
  let watermarked = null;
  wmBtn.addEventListener('click', async () => {
    if (watermarked) {
      img.src = url;
      watermarked = null;
      wmBtn.textContent = '疊上浮水印預覽';
      return;
    }
    watermarked = await applyWatermark(m.blob, entry, project);
    img.src = URL.createObjectURL(watermarked);
    wmBtn.textContent = '看原圖';
  });

  const shareBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '分享（含浮水印）' });
  shareBtn.addEventListener('click', async () => {
    const blob = watermarked || await applyWatermark(m.blob, entry, project);
    const file = new File([blob], `${entry.date}_${entry.floor || '照片'}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    }
  });

  const actions = el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' }, [wmBtn, shareBtn]);

  if (allowImageUpload) {
    const askBtn = el('button', { class: 'btn ghost sm', type: 'button' }, [icon('sparkle', { size: 16 }), '問 AI 這張照片']);
    const setAskLabel = (busy) => askBtn.replaceChildren(
      icon('sparkle', { size: 16 }), busy ? '詢問中…' : '問 AI 這張照片');
    askBtn.addEventListener('click', async () => {
      const q = prompt('想問什麼？（AI 只會描述看到什麼，不會判斷合不合格）');
      if (!q) return;
      const ok = await confirmDialog({
        title: '要把這張照片上傳嗎？',
        body: '整張原圖會送到 Google。確認照片裡沒有不該外流的東西（案名招牌、圖說、人臉）。',
        okLabel: '上傳',
      });
      if (!ok) return;
      askBtn.disabled = true;
      setAskLabel(true);
      try {
        const answer = await describeImage(m.blob, q);
        actions.after(el('div', { class: 'ai-block', style: 'margin-top:10px' }, [
          el('span', { class: 'badge badge-unverified', text: '未查證' }),
          el('div', { style: 'margin-top:6px;white-space:pre-wrap', text: answer }),
        ]));
      } catch (err) {
        toast(err.message, 5000);
      } finally {
        askBtn.disabled = false;
        setAskLabel(false);
      }
    });
    actions.append(askBtn);
  }

  const close = el('button', { class: 'btn ghost sm', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());
  actions.append(close);

  dlg.append(img, actions);
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => { URL.revokeObjectURL(url); dlg.remove(); }, { once: true });
}
