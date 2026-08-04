// 公共工程監造日報表（五段式）＋ 自由摘要。
//
// 表頭欄位從專案與當日工地資訊自動帶入，內文由 AI 從當天的記錄整理。
// 格式集中在 report-template.js，將來要換成公司的制式表格只要改那個檔。

import { el, setTitle, fmtDate, toast, confirmDialog, flushActiveInput } from '../ui.js';
import { get, listEntries, getOrCreateDay, getReport, saveReport, reportId, getSetting } from '../db.js';
import { REPORT_SECTIONS, makeReport } from '../gemini.js';
import { confirmUpload } from '../confirm-upload.js';
import { buildMaterial, renderReportText } from '../report-template.js';
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
      el('p', { class: 'muted' }, '日報是從當天的記錄整理出來的，先去記幾筆。'),
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
  const genBtn = el('button', { class: 'btn block', type: 'button', text: '✨ 從今天的記錄產生日報' });
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
      extraNote: '只送文字，照片不會上傳。AI 被禁止補充任何你沒寫的內容，'
        + '找不到對應內容的段落會寫「本日無」。',
    });
    if (toSend === null) return;

    genBtn.disabled = true;
    genBtn.textContent = '整理中…';
    try {
      const out = await makeReport(toSend);
      for (const s of REPORT_SECTIONS) boxes[s.key].value = revertAliases(out[s.key] || '', aliases);
      freeBox.value = revertAliases(out.freeSummary || '', aliases);
      await persist(false);
      toast('產生好了。這是草稿，送出前請自己逐段核對。', 5000);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = '✨ 從今天的記錄產生日報';
    }
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

  const statusNotice = el('div', { class: 'notice warn' }, [
    el('strong', { text: 'AI 產出的日報是草稿，不是可以直接交出去的表報。' }),
    '每一段都要自己核對過。它被禁止編造，但語音辨識錯字、分段錯位還是會發生。',
  ]);

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

  wrap.append(
    statusNotice,
    genBtn,
    el('div', { style: 'height:12px' }),
    sectionCard,
    el('label', { class: 'row', style: 'gap:10px;margin:0 0 14px;cursor:pointer' }, [
      verifyBox,
      el('span', { text: '我已經逐段核對過這份日報' }),
    ]),
    el('div', { class: 'row wrap', style: 'gap:8px' }, [saveBtn, copyBtn]),
  );

  return wrap;
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
