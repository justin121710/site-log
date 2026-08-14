// 專案的報表中心。日報在「某一天」那頁產，這裡放跨日期的彙整報表。

import { el, setTitle, field, dateField, input, toast, today, flushActiveInput } from '../ui.js';
import {
  get, listEntries, getAll, listProjects, groupDefects, listEntriesByCategory,
} from '../db.js';
import { CATEGORIES, categoryName } from '../taxonomy.js';
import {
  buildPeriodReportHtml, buildDefectReportHtml,
  buildCategoryReportHtml, buildProjectBookHtml,
} from '../report-html.js';
import { presentReport } from '../export-ui.js';

/** 往前推 n 天的日期字串。 */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return today(d);
}

async function daysMap(projectId) {
  const rows = (await getAll('days')).filter((d) => d.projectId === projectId);
  return Object.fromEntries(rows.map((d) => [d.date, d]));
}

export default async function reports({ projectId }) {
  const project = await get('projects', projectId);
  if (!project) throw new Error('找不到這個專案');
  setTitle('報表');

  const wrap = el('div');
  const allEntries = await listEntries(projectId);

  // 共用：照片張數與一頁幾張
  let perPage = 2;
  let withPhotos = true;

  const photoToggle = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
  photoToggle.checked = true;
  photoToggle.addEventListener('change', () => { withPhotos = photoToggle.checked; });

  const perBtns = [[2, '一頁 2 張'], [4, '一頁 4 張']].map(([v, label]) => {
    const b = el('button', { class: 'chip sm', type: 'button', 'aria-pressed': String(v === perPage), text: label });
    b.addEventListener('click', () => {
      perPage = v;
      for (const x of perBtns) x.setAttribute('aria-pressed', String(x === b));
    });
    return b;
  });

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '照片' }),
    el('label', { class: 'row', style: 'gap:10px;cursor:pointer;margin-bottom:10px' }, [
      photoToggle,
      el('span', { text: '報表附照片' }),
    ]),
    el('div', { class: 'chips' }, perBtns),
  ]));

  /** 統一的產生流程：跑 builder、把結果丟給 presentReport。 */
  const run = async (btn, fn) => {
    flushActiveInput();
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '產生中…';
    try {
      presentReport(await fn());
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  // ---------- 期間報表 ----------
  const fromInput = input({ type: 'date', value: daysAgo(6) });
  const toInput = input({ type: 'date', value: today() });

  const quick = [['本週', 6], ['本月', 29], ['近 90 天', 89]].map(([label, n]) => {
    const b = el('button', { class: 'chip sm', type: 'button', text: label });
    b.addEventListener('click', () => { fromInput.value = daysAgo(n); toInput.value = today(); });
    return b;
  });

  const periodBtn = el('button', { class: 'btn block', type: 'button', text: '產生期間報表' });
  periodBtn.addEventListener('click', () => run(periodBtn, async () => {
    const from = fromInput.value;
    const to = toInput.value;
    if (!from || !to) throw new Error('起訖日期都要填');
    if (from > to) throw new Error('起始日不能晚於結束日');
    const entries = allEntries.filter((e) => e.date >= from && e.date <= to);
    return buildPeriodReportHtml({
      project, from, to, entries, days: await daysMap(projectId), perPage, withPhotos,
    });
  }));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '期間報表（週報／月報）' }),
    el('div', { class: 'chips', style: 'margin-bottom:12px' }, quick),
    el('div', { class: 'grid2 dates' }, [dateField('起', fromInput), dateField('迄', toInput)]),
    periodBtn,
  ]));

  // ---------- 缺失追蹤表 ----------
  const groups = await groupDefects(projectId);
  const defectBtn = el('button', { class: 'btn block', type: 'button', text: '產生缺失追蹤表' });
  defectBtn.addEventListener('click', () => run(defectBtn, async () =>
    buildDefectReportHtml({ project, groups: await groupDefects(projectId), perPage, withPhotos })));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '缺失追蹤表' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' },
      groups.length
        ? `${groups.length} 件　`
          + ['開立', '改正中', '已複驗'].map((s) => `${s} ${groups.filter((g) => g.status === s).length}`).join('　')
        : '還沒有填單號的缺失記錄。'),
    defectBtn,
  ]));

  // ---------- 單一工項彙整 ----------
  const catSel = el('select', {}, CATEGORIES.map((c) => el('option', { value: c.id }, c.name)));
  const crossBox = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });

  const catBtn = el('button', { class: 'btn block', type: 'button', text: '產生工項彙整' });
  catBtn.addEventListener('click', () => run(catBtn, async () => {
    const catId = catSel.value;
    const all = await listEntriesByCategory(catId);
    const entries = crossBox.checked ? all : all.filter((e) => e.projectId === projectId);
    const projectsById = Object.fromEntries((await listProjects()).map((p) => [p.id, p]));
    return buildCategoryReportHtml({
      categoryId: catId, categoryLabel: categoryName(catId), entries, projectsById, perPage, withPhotos,
    });
  }));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '單一工項彙整' }),
    field('工項', catSel),
    el('label', { class: 'row', style: 'gap:10px;cursor:pointer;margin:10px 0' }, [
      crossBox,
      el('span', { text: '涵蓋所有專案（跨案場比對）' }),
    ]),
    catBtn,
  ]));

  // ---------- 專案完整本 ----------
  const bookBtn = el('button', { class: 'btn block', type: 'button', text: '產生完整本' });
  bookBtn.addEventListener('click', () => run(bookBtn, async () =>
    buildProjectBookHtml({
      project, entries: await listEntries(projectId), days: await daysMap(projectId), perPage, withPhotos,
    })));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '專案完整本' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 10px' }, `全部 ${allEntries.length} 筆`),
    bookBtn,
  ]));

  return wrap;
}
