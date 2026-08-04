// 專案首頁：今天的記錄、當日工地資訊、日報入口、往前翻日期。

import { el, setTitle, fmtDate, fmtTime, today } from '../ui.js';
import { get, listEntries } from '../db.js';
import { categoryIcon } from '../taxonomy.js';

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
    text: '＋ 新增記錄',
    style: 'margin-bottom:12px',
  }));

  wrap.append(el('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:14px' }, [
    el('a', { href: `#/p/${p.id}/day/${t}`, class: 'btn ghost sm', text: '今天的記錄' }),
    el('a', { href: `#/p/${p.id}/report/${t}`, class: 'btn ghost sm', text: '今日日報' }),
    el('a', { href: `#/p/${p.id}/edit`, class: 'btn ghost sm', text: '專案設定' }),
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
      const icons = [...new Set(dayEntries.flatMap((e) => e.categoryIds))].map(categoryIcon).join(' ');
      const preview = dayEntries[0];
      card.append(el('div', { class: 'muted', style: 'margin-top:4px' },
        `${icons}　${fmtTime(preview.capturedAt)} ${firstLine(preview)}`));
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
