// 新增／編輯專案。表頭欄位直接對應公共工程監造日報表，建一次之後日報自動帶入。

import { el, setTitle, field, input, toast, confirmDialog, flushActiveInput } from '../ui.js';
import { get, newProject, saveProject, del, listEntries, deleteEntry } from '../db.js';
import { COUNTIES, districtsOf, formatSite } from '../twzones.js';

export default async function projectEdit({ projectId }) {
  const isNew = projectId === 'new';
  const p = isNew ? newProject() : await get('projects', projectId);
  if (!p) throw new Error('找不到這個專案');

  setTitle(isNew ? '新增專案' : '編輯專案');
  const wrap = el('div');

  const f = {};
  const mk = (key, label, attrs = {}, hint = '') => {
    f[key] = input({ value: p[key] ?? '', ...attrs });
    return field(label, f[key], hint);
  };

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '基本資料' }),
    mk('name', '工程名稱', { placeholder: '例：○○捷運工程 CJ123 標' }),
    mk('code', '代號', { placeholder: '例：A案' }),
    el('div', { class: 'grid2' }, [
      mk('contractNo', '契約編號'),
      mk('agency', '主辦機關'),
      mk('supervisorUnit', '監造單位'),
      mk('contractor', '承商'),
    ]),
  ]));

  // ---------- 工址 ----------
  // 一座橋、一段護岸就在那裡不會動，所以行政區填一次就好，
  // 每筆記錄只要記工地「裡面」的相對位置（樁號、墩號、左右岸）。
  p.site = { county: '', district: '', village: '', address: '', ...(p.site || {}) };

  const countySel = el('select', {}, [
    el('option', { value: '' }, '（未選）'),
    ...COUNTIES.map((c) => el('option', { value: c, selected: c === p.site.county }, c)),
  ]);
  const districtSel = el('select', {});
  const fillDistricts = () => {
    const list = districtsOf(countySel.value);
    districtSel.replaceChildren(
      el('option', { value: '' }, list.length ? '（未選）' : '（先選縣市）'),
      ...list.map((d) => el('option', { value: d, selected: d === p.site.district }, d)),
    );
  };
  fillDistricts();
  countySel.addEventListener('change', () => {
    p.site.district = ''; // 換縣市時舊的區一定不對，直接清掉
    fillDistricts();
    updateSitePreview();
  });
  districtSel.addEventListener('change', updateSitePreview);

  const villageInput = input({ value: p.site.village, placeholder: '例：中興里（沒有可留空）' });
  const addressInput = input({ value: p.site.address, placeholder: '例：臺 3 線 K12+350 左岸' });
  villageInput.addEventListener('input', updateSitePreview);
  addressInput.addEventListener('input', updateSitePreview);

  const sitePreview = el('div', { class: 'muted', style: 'margin-top:4px' });
  function updateSitePreview() {
    const s = formatSite({
      county: countySel.value,
      district: districtSel.value,
      village: villageInput.value,
      address: addressInput.value,
    });
    sitePreview.textContent = s ? `工址：${s}` : '還沒填工址';
  }
  updateSitePreview();

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '工址' }),
    el('div', { class: 'grid2' }, [
      field('縣市', countySel),
      field('鄉鎮市區', districtSel),
    ]),
    field('里／村', villageInput),
    field('路段、樁號或其他描述', addressInput),
    sitePreview,
  ]));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '工期與進度' }),
    el('div', { class: 'grid2' }, [
      mk('startDate', '開工日期', { type: 'date' }),
      mk('plannedEndDate', '預定竣工日期', { type: 'date' }),
      mk('contractDays', '契約工期（天）', { type: 'number', inputmode: 'numeric' }),
      mk('contractAmount', '契約金額'),
      mk('plannedProgress', '預定進度（%）', { type: 'number', inputmode: 'decimal' }),
      mk('actualProgress', '實際進度（%）', { type: 'number', inputmode: 'decimal' }),
    ]),
  ]));

  const save = el('button', { class: 'btn block', text: isNew ? '建立專案' : '儲存' });
  save.addEventListener('click', async () => {
    flushActiveInput();
    for (const [k, node] of Object.entries(f)) p[k] = node.value.trim();
    p.site = {
      county: countySel.value,
      district: districtSel.value,
      village: villageInput.value.trim(),
      address: addressInput.value.trim(),
    };
    if (!p.name) { toast('工程名稱是必填的'); f.name.focus(); return; }
    await saveProject(p);
    toast('已儲存');
    location.hash = `#/p/${p.id}`;
  });
  wrap.append(save);

  if (!isNew) {
    const rm = el('button', {
      class: 'btn ghost block',
      text: '刪除這個專案',
      style: 'margin-top:10px;color:var(--danger)',
    });
    rm.addEventListener('click', async () => {
      const entries = await listEntries(p.id);
      const ok = await confirmDialog({
        title: '刪除專案？',
        body: `會一併刪掉底下 ${entries.length} 筆記錄與所有照片、錄音。這個動作沒辦法復原。`,
        okLabel: '刪除',
      });
      if (!ok) return;
      for (const e of entries) await deleteEntry(e.id);
      await del('projects', p.id);
      toast('已刪除');
      location.hash = '#/';
    });
    wrap.append(rm);
  }

  return wrap;
}
