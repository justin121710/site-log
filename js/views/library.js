// 工項分類首頁：內建分類 + 你自己加的分類，跨專案。

import { el, setTitle, toast } from '../ui.js';
import { CATEGORIES, isCustomCategory, addCategory } from '../taxonomy.js';
import { countByIndex } from '../db.js';
import { icon, PICKABLE_ICONS } from '../icons.js';

export default async function library() {
  setTitle('工項分類');
  const wrap = el('div');
  const list = el('div', { class: 'cat-grid' });

  async function renderList() {
    list.replaceChildren();
    for (const c of CATEGORIES) {
      const n = await countByIndex('entries', 'categoryIds', IDBKeyRange.only(c.id));
      list.append(el('a', {
        href: `#/lib/${c.id}`,
        class: `cat-tile ${n ? 'has-items' : ''}`.trim(),
      }, [
        isCustomCategory(c.id) ? el('span', { class: 'cat-custom', text: '自訂' }) : null,
        el('span', { class: 'cat-count', text: n ? String(n) : '' }),
        icon(c.icon, { size: 28 }),
        el('span', { class: 'cat-name', text: c.name }),
      ]));
    }
  }

  const addBtn = el('button', { class: 'btn block', type: 'button', style: 'margin-bottom:14px' },
    [icon('plus'), '新增分類']);
  addBtn.addEventListener('click', async () => {
    const created = await newCategoryDialog();
    if (!created) return;
    await renderList();
    toast(`已新增「${created.name}」`);
  });

  wrap.append(
    el('a', { href: '#/search', class: 'btn ghost block', style: 'margin-bottom:10px' },
      [icon('search'), '搜尋所有記錄']),
    el('a', { href: '#/laws', class: 'btn ghost block', style: 'margin-bottom:10px' },
      [icon('book'), '查法規']),
    addBtn,
    list,
  );

  await renderList();
  return wrap;
}

/** @returns {Promise<{id,name,icon}|null>} */
export function newCategoryDialog() {
  const dlg = el('dialog');
  let picked = 'note';

  const nameInput = el('input', { type: 'text', placeholder: '例：地下連續壁、監測系統' });
  const grid = el('div', { class: 'chips' });

  const buttons = PICKABLE_ICONS.map((name) => {
    const b = el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(name === picked),
      'aria-label': name,
      style: 'padding:0 10px',
    }, [icon(name, { size: 20 })]);
    b.addEventListener('click', () => {
      picked = name;
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
    });
    return b;
  });
  grid.append(...buttons);

  const cancel = el('button', { class: 'btn ghost', type: 'button', text: '取消' });
  const ok = el('button', { class: 'btn', type: 'button', text: '新增' });

  dlg.append(el('div', {}, [
    el('h2', { text: '新增分類' }),
    el('label', { class: 'field' }, [el('span', { text: '分類名稱' }), nameInput]),
    el('label', { class: 'field' }, [el('span', { text: '圖示' }), grid]),
    el('menu', {}, [cancel, ok]),
  ]));

  document.body.append(dlg);
  dlg.showModal();
  nameInput.focus();

  return new Promise((resolve) => {
    let result = null;
    cancel.addEventListener('click', () => dlg.close());
    ok.addEventListener('click', async () => {
      try {
        result = await addCategory({ name: nameInput.value, icon: picked });
        dlg.close();
      } catch (err) {
        toast(err.message, 4000);
      }
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); }, { once: true });
  });
}
