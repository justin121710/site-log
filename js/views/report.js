// 公共工程監造日報表（五段式）＋ 自由摘要。
//
// 表頭欄位從專案與當日工地資訊自動帶入，內文由 AI 從當天的記錄整理。
// 格式集中在 report-template.js，將來要換成公司的制式表格只要改那個檔。

import { el, setTitle, fmtDate, toast, confirmDialog, flushActiveInput } from '../ui.js';
import { get, listEntries, getOrCreateDay, getReport, saveReport, reportId, getSetting } from '../db.js';
import { REPORT_SECTIONS, makeReport } from '../gemini.js';
import { confirmUpload } from '../confirm-upload.js';
import { buildMaterial, renderReportText, buildLocalDraft } from '../report-template.js';
import { icon } from '../icons.js';
import { buildDailyReportHtml, buildPhotoSheetHtml } from '../report-html.js';
import { presentReport } from '../export-ui.js';
import { revertAliases, getAliases } from '../redact.js';

export default async function report({ projectId, date }) {
  const project = await get('projects', projectId);
  if (!project) throw new Error('找不到這個專案');
  setTitle(`日報 ${fmtDate(date)}`);

  const day = await getOrCreateDay(projectId, date);
  const entries = await listEntries(projectId, date);
  const aliases = await getAliases();

  let saved = await getReport(projectId, date);
  const wrap = el('div');

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: project.name || '（未命名專案）' }),
    el('div', { class: 'muted' }, [
      fmtDate(date),
      project.contractNo ? `　契約 ${project.contractNo}` : '',
      `　${entries.length} 筆記錄`,
    ].join('')),
    el('div', { class: 'muted', style: 'margin-top:4px' }, [
      day.weatherAM || day.weatherPM ? `天氣 上午${day.weatherAM || '—'}／下午${day.weatherPM || '—'}` : '',
      day.manpower ? `　出工 ${day.manpower} 人` : '',
    ].join('')),
  ]));

  if (!entries.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('strong', { text: '這天還沒有記錄' }),
      el('a', { href: `#/p/${projectId}/day/${date}`, class: 'btn ghost', style: 'margin-top:10px' }, '回到這天'),
    ]));
    return wrap;
  }

  // ---------- 五段 ----------
  const boxes = {};
  const sectionCard = el('div', { class: 'card' });
  sectionCard.append(el('h2', { text: '監造日報表內容' }));

  for (const s of REPORT_SECTIONS) {
    const ta = el('textarea', { style: 'min-height:90px' });
    ta.value = saved?.sections?.[s.key] || '';
    boxes[s.key] = ta;
    sectionCard.append(el('label', { class: 'field' }, [
      el('span', { text: s.title, style: 'line-height:1.4' }),
      ta,
    ]));
  }

  const freeBox = el('textarea', { style: 'min-height:90px' });
  freeBox.value = saved?.freeSummary || '';
  sectionCard.append(el('label', { class: 'field' }, [
    el('span', { text: '今日心得・待追蹤（給自己看的，不是表報內容）' }),
    freeBox,
  ]));

  // ---------- 產生 ----------
  const genBtn = el('button', { class: 'btn block', type: 'button' }, [icon('sparkle'), '從今天的記錄產生日報']);
  const setGenLabel = (busy) => genBtn.replaceChildren(
    icon('sparkle'), busy ? '整理中…' : '從今天的記錄產生日報');
  genBtn.addEventListener('click', async () => {
    flushActiveInput();
    const hasContent = Object.values(boxes).some((b) => b.value.trim()) || freeBox.value.trim();
    if (hasContent && !await confirmDialog({
      title: '要覆蓋現在的內容嗎？',
      body: '重新產生會蓋掉你已經改過的文字。',
      okLabel: '重新產生',
    })) return;

    const material = buildMaterial({ project, day, entries, date });
    const toSend = await confirmUpload(material, {
      title: '要送今天的記錄給 Gemini 嗎？',
      extraNote: '只送文字，照片不會上傳。',
    });
    if (toSend === null) return;

    genBtn.disabled = true;
    setGenLabel(true);
    try {
      const out = await makeReport(toSend);
      for (const s of REPORT_SECTIONS) boxes[s.key].value = revertAliases(out[s.key] || '', aliases);
      freeBox.value = revertAliases(out.freeSummary || '', aliases);
      await persist(false);
      toast('產生好了，請自己逐段核對', 4000);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      genBtn.disabled = false;
      setGenLabel(false);
    }
  });

  // 不用 AI 的路。沒網路、沒額度、沒帳號一樣做得出草稿。
  const localBtn = el('button', { class: 'btn ghost block', type: 'button', text: '本機整理草稿（不用 AI）' });
  localBtn.addEventListener('click', async () => {
    flushActiveInput();
    const hasContent = Object.values(boxes).some((b) => b.value.trim()) || freeBox.value.trim();
    if (hasContent && !await confirmDialog({
      title: '要覆蓋現在的內容嗎？',
      body: '重新產生會蓋掉你已經改過的文字。',
      okLabel: '重新產生',
    })) return;

    const out = buildLocalDraft({ entries });
    for (const s of REPORT_SECTIONS) boxes[s.key].value = out[s.key];
    freeBox.value = out.freeSummary;
    await persist(false);
    toast('已依分類分好段', 3000);
  });

  async function persist(quiet = true) {
    saved = {
      id: reportId(projectId, date),
      projectId,
      date,
      sections: Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, boxes[s.key].value])),
      freeSummary: freeBox.value,
      verified: verifyBox.checked,
      model: await getSetting('geminiModel', ''),
      generatedAt: saved?.generatedAt || new Date().toISOString(),
    };
    await saveReport(saved);
    if (!quiet) toast('已儲存');
  }

  // ---------- 未查證 / 已確認 ----------
  const verifyBox = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
  verifyBox.checked = !!saved?.verified;
  verifyBox.addEventListener('change', () => persist(true));

  const aiEnabled = await getSetting('aiEnabled', true);

  // 這一句留著但縮短：監造有法律責任，這是唯一提醒「產出不能直接信」的地方
  const statusNotice = el('div', { class: 'notice warn' },
    aiEnabled ? '草稿，送出前請自己逐段核對。' : '依分類分段，文字全是你自己寫的。');

  // ---------- 匯出 ----------
  const copyBtn = el('button', { class: 'btn ghost', type: 'button', text: '複製全文' });
  copyBtn.addEventListener('click', async () => {
    flushActiveInput();
    const text = renderReportText({
      project,
      day,
      date,
      sections: Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, boxes[s.key].value])),
      freeSummary: freeBox.value,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製，可以貼到公司的表單裡');
    } catch {
      // iOS 在非使用者手勢或非安全環境下會擋剪貼簿，退回顯示讓他自己選取
      showTextDialog(text);
    }
  });

  const saveBtn = el('button', { class: 'btn ghost', type: 'button', text: '儲存' });
  saveBtn.addEventListener('click', async () => { flushActiveInput(); await persist(false); });

  // ---------- 匯出成可列印的 HTML ----------
  const currentSections = () =>
    Object.fromEntries(REPORT_SECTIONS.map((s) => [s.key, boxes[s.key].value]));

  const htmlBtn = el('button', { class: 'btn', type: 'button', text: '匯出報表（可印成 PDF）' });
  htmlBtn.addEventListener('click', async () => {
    flushActiveInput();
    await persist(true);
    const opened = await exportChoiceDialog();
    if (!opened) return;
    htmlBtn.disabled = true;
    htmlBtn.textContent = '產生中…';
    try {
      const out = opened.kind === 'photos'
        ? await buildPhotoSheetHtml({ project, date, entries, perPage: opened.perPage })
        : await buildDailyReportHtml({
          project, day, date, entries,
          sections: currentSections(),
          freeSummary: freeBox.value,
          perPage: opened.perPage,
          withPhotos: opened.kind === 'full',
        });
      presentReport(out);
    } catch (err) {
      toast(`產生失敗：${err.message}`, 5000);
    } finally {
      htmlBtn.disabled = false;
      htmlBtn.textContent = '匯出報表（可印成 PDF）';
    }
  });

  wrap.append(
    statusNotice,
    aiEnabled ? genBtn : null,
    aiEnabled ? el('div', { style: 'height:8px' }) : null,
    localBtn,
    el('div', { style: 'height:12px' }),
    sectionCard,
    el('label', { class: 'row', style: 'gap:10px;margin:0 0 14px;cursor:pointer' }, [
      verifyBox,
      el('span', { text: '我已經逐段核對過這份日報' }),
    ]),
    htmlBtn,
    el('div', { class: 'row wrap', style: 'gap:8px;margin-top:10px' }, [saveBtn, copyBtn]),
  );

  return wrap;
}

/** @returns {Promise<{kind:'full'|'textonly'|'photos', perPage:2|4}|null>} */
function exportChoiceDialog() {
  const dlg = el('dialog');
  let kind = 'full';
  let perPage = 2;

  const mkGroup = (options, get, set) => {
    const wrap = el('div', { class: 'chips' });
    const btns = options.map(([v, label]) => {
      const b = el('button', { class: 'chip sm', type: 'button', 'aria-pressed': String(get() === v), text: label });
      b.addEventListener('click', () => {
        set(v);
        for (const x of btns) x.setAttribute('aria-pressed', String(x === b));
      });
      return b;
    });
    wrap.append(...btns);
    return wrap;
  };

  const cancel = el('button', { class: 'btn ghost', type: 'button', text: '取消' });
  const ok = el('button', { class: 'btn', type: 'button', text: '產生' });

  dlg.append(el('div', {}, [
    el('h2', { text: '要產生什麼' }),
    mkGroup([
      ['full', '日報 + 施工照片表'],
      ['textonly', '只要日報本文'],
      ['photos', '只要施工照片表'],
    ], () => kind, (v) => { kind = v; }),

    el('div', { class: 'muted', style: 'margin:14px 0 6px;font-size:13px' }, '照片表一頁幾張'),
    mkGroup([[2, '2 張（大，看得出細節）'], [4, '4 張（省紙）']], () => perPage, (v) => { perPage = v; }),

    el('menu', {}, [cancel, ok]),
  ]));

  document.body.append(dlg);
  dlg.showModal();

  return new Promise((resolve) => {
    let result = null;
    cancel.addEventListener('click', () => dlg.close());
    ok.addEventListener('click', () => { result = { kind, perPage }; dlg.close(); });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); }, { once: true });
  });
}

function showTextDialog(text) {
  const dlg = el('dialog');
  const pre = el('pre', { text });
  const close = el('button', { class: 'btn ghost', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());
  dlg.append(el('h2', { text: '長按選取複製' }), pre, el('menu', {}, [close]));
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
}
