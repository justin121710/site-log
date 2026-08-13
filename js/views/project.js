// 專案首頁：今天的記錄、當日工地資訊、日報入口、往前翻日期。

import { el, setTitle, fmtDate, fmtTime, today } from '../ui.js';
import { get, listEntries } from '../db.js';
import { categoryIcon } from '../taxonomy.js';
import { icon } from '../icons.js';
import { exportDialog } from '../export-ui.js';

export default async function project({ projectId }) {
  const p = await get('projects', projectId);
  if (!p) throw new Error('找不到這個專案');
  setTitle(p.name || '專案');

  const wrap = el('div');
  const all = await listEntries(p.id);
  const dates = [...new Set(all.map((e) => e.date))].sort().reverse();
  const t = today();
  if (!dates.includes(t)) dates.unshift(t);

  wrap.append(el('a', {
    href: `#/p/${p.id}/new`,
    class: 'btn block',
    style: 'margin-bottom:12px',
  }, [icon('plus'), '新增記錄']));

  const exportBtn = el('button', { class: 'btn ghost sm', type: 'button', text: '匯出' });
  exportBtn.addEventListener('click', () =>
    exportDialog({ projectId: p.id, title: p.name || '這個專案' }));

  wrap.append(el('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:14px' }, [
    el('a', { href: `#/p/${p.id}/day/${t}`, class: 'btn ghost sm', text: '今天的記錄' }),
    el('a', { href: `#/p/${p.id}/report/${t}`, class: 'btn ghost sm', text: '今日日報' }),
    el('a', { href: `#/p/${p.id}/reports`, class: 'btn ghost sm', text: '報表' }),
    el('a', { href: `#/p/${p.id}/edit`, class: 'btn ghost sm', text: '專案設定' }),
    exportBtn,
  ]));

  for (const date of dates.slice(0, 30)) {
    const dayEntries = all.filter((e) => e.date === date);
    const card = el('a', { href: `#/p/${p.id}/day/${date}`, class: 'card' }, [
      el('div', { class: 'row' }, [
        el('strong', { text: fmtDate(date) }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted', text: `${dayEntries.length} 筆` }),
      ]),
    ]);
    if (dayEntries.length) {
      const cats = [...new Set(dayEntries.flatMap((e) => e.categoryIds))];
      const preview = dayEntries[0];
      card.append(el('div', { class: 'row', style: 'margin-top:5px;gap:6px' }, [
        ...cats.slice(0, 5).map((c) => icon(categoryIcon(c), { size: 16 })),
        el('span', { class: 'muted', style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
          `${fmtTime(preview.capturedAt)} ${firstLine(preview)}`),
      ]));
    } else {
      card.append(el('div', { class: 'muted', style: 'margin-top:4px', text: '還沒有記錄' }));
    }
    wrap.append(card);
  }

  return wrap;
}

function firstLine(entry) {
  const src = entry.ai?.tidied || entry.transcript || entry.note || '';
  const line = src.split('\n')[0].trim();
  return line.length > 30 ? `${line.slice(0, 30)}…` : line;
}
