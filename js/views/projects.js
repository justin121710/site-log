// 專案列表

import { el, setTitle, fmtDate, today } from '../ui.js';
import { listProjects, countByIndex } from '../db.js';
import { icon } from '../icons.js';
import { backupIsOverdue, getLastBackup, BACKUP_NAG_DAYS } from '../export.js';
import { exportDialog } from '../export-ui.js';

export default async function projects() {
  setTitle('專案');
  const rows = await listProjects();
  const wrap = el('div');

  // 工地資料重做不回來，所以太久沒備份就直接擋在首頁上念
  if (await backupIsOverdue()) {
    const { days } = await getLastBackup();
    const nagBtn = el('button', { class: 'btn sm', type: 'button', text: '現在備份' });
    nagBtn.addEventListener('click', () => exportDialog({ title: '全部資料' }));
    wrap.append(el('div', { class: 'notice warn' }, [
      el('strong', { text: days === null ? '你還沒備份過' : `已經 ${days} 天沒備份了` }),
      el('div', { style: 'margin-bottom:9px' }, '照片與錄音只在這台裝置上，重做不回來。'),
      nagBtn,
    ]));
  }

  wrap.append(
    el('a', { href: '#/p/new/edit', class: 'btn block', style: 'margin-bottom:14px' },
      [icon('plus'), '新增專案'])
  );

  if (!rows.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有專案' }),
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
