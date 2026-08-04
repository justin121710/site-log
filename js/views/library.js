// 經驗庫首頁：14 項分類，跨專案。

import { el, setTitle } from '../ui.js';
import { CATEGORIES } from '../taxonomy.js';
import { countByIndex } from '../db.js';

export default async function library() {
  setTitle('經驗庫');
  const wrap = el('div');

  wrap.append(el('p', { class: 'muted', style: 'margin:0 0 14px' },
    '同一件事在不同案場怎麼做，都收在同一個分類底下，之後要設計時可以直接比對。'));

  for (const c of CATEGORIES) {
    const n = await countByIndex('entries', 'categoryIds', IDBKeyRange.only(c.id));
    wrap.append(el('a', { href: `#/lib/${c.id}`, class: 'card' }, [
      el('div', { class: 'row' }, [
        el('span', { text: c.icon, style: 'font-size:24px' }),
        el('strong', { text: c.name, style: 'font-size:16px' }),
        el('span', { class: 'spacer' }),
        el('span', { class: n ? '' : 'muted', text: `${n} 筆` }),
      ]),
    ]));
  }

  return wrap;
}
