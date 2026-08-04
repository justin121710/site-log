// 新增／編輯專案。表頭欄位直接對應公共工程監造日報表，建一次之後日報自動帶入。

import { el, setTitle, field, input, toast, confirmDialog, flushActiveInput } from '../ui.js';
import { get, newProject, saveProject, del, listEntries, deleteEntry } from '../db.js';

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
    mk('code', '代號', { placeholder: '例：A案' },
      '送 AI 之前會用這個代號取代真實工程名稱。留空就不替換。'),
    el('div', { class: 'grid2' }, [
      mk('contractNo', '契約編號'),
      mk('agency', '主辦機關'),
      mk('supervisorUnit', '監造單位'),
      mk('contractor', '承商'),
    ]),
  ]));

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '工期與進度' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 12px' },
      '這幾欄會自動帶進每天的監造日報表頭，建一次就好。'),
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
