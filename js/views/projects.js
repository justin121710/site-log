// 專案列表

import { el, setTitle, fmtDate, today } from '../ui.js';
import { listProjects, countByIndex } from '../db.js';
import { icon } from '../icons.js';

export default async function projects() {
  setTitle('專案');
  const rows = await listProjects();
  const wrap = el('div');

  wrap.append(
    el('a', { href: '#/p/new/edit', class: 'btn block', style: 'margin-bottom:14px' },
      [icon('plus'), '新增專案'])
  );

  if (!rows.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有專案' }),
      el('p', { class: 'muted', text: '先建一個案場，之後拍的每一筆記錄都會歸到它底下。' }),
    ]));
    return wrap;
  }

  for (const p of rows) {
    const count = await countByIndex('entries', 'projectId', IDBKeyRange.only(p.id));
    wrap.append(el('a', { href: `#/p/${p.id}`, class: 'card' }, [
      el('div', { class: 'row' }, [
        el('strong', { text: p.name || '（未命名專案）', style: 'font-size:17px' }),
        el('span', { class: 'spacer' }),
        p.code ? el('span', { class: 'badge badge-cat', text: p.code }) : null,
      ]),
      el('div', { class: 'muted', style: 'margin-top:4px' }, [
        `${count} 筆記錄`,
        p.contractNo ? ` · 契約 ${p.contractNo}` : '',
        p.startDate ? ` · 開工 ${p.startDate}` : '',
      ].join('')),
    ]));
  }

  wrap.append(el('div', { class: 'muted', style: 'text-align:center;margin-top:6px' },
    `今天 ${fmtDate(today())}`));

  return wrap;
}
