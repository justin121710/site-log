// 搜尋。跨專案、跨工項，找的是你自己記過的東西。

import { el, append, setTitle, input, toast, debounce, highlight, fmtDate, fmtTime } from '../ui.js';
import { searchEntries } from '../search.js';
import { listProjects } from '../db.js';
import { CATEGORIES } from '../taxonomy.js';

export default async function search() {
  setTitle('搜尋');
  const wrap = el('div');

  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const box = input({ placeholder: '例：保護層、墊塊、D-002', value: query.get('q') || '' });
  box.setAttribute('enterkeyhint', 'search');

  const projSel = el('select', {}, [el('option', { value: '' }, '全部專案')]);
  for (const p of await listProjects()) {
    projSel.append(el('option', { value: p.id }, p.name || '（未命名）'));
  }
  const catSel = el('select', {}, [
    el('option', { value: '' }, '全部工項'),
    ...CATEGORIES.map((c) => el('option', { value: c.id }, c.name)),
  ]);

  const status = el('div', { class: 'muted', style: 'margin-top:10px;min-height:1.5em' });
  const list = el('div');

  wrap.append(el('div', { class: 'card' }, [
    box,
    el('div', { style: 'height:10px' }),
    el('div', { class: 'grid2' }, [projSel, catSel]),
    status,
  ]), list);

  const run = async () => {
    const q = box.value.trim();
    list.replaceChildren();
    try {
      const { hits, total, words, scanned } = await searchEntries(q, {
        projectId: projSel.value,
        categoryId: catSel.value,
      });

      if (!q) { status.textContent = `${scanned} 筆記錄，打字開始找`; return; }
      status.textContent = total
        ? `找到 ${total} 筆${total > hits.length ? `，顯示前 ${hits.length} 筆` : ''}`
        : '沒有找到，換個詞試試';

      for (const h of hits) {
        const card = el('a', { href: `#/e/${h.id}`, class: 'card' });
        append(card,
          el('div', { class: 'row', style: 'gap:8px;margin-bottom:4px' }, [
            el('strong', { text: h.projectName, style: 'font-size:15px' }),
            el('span', { class: 'spacer' }),
            el('span', { class: 'muted', style: 'font-size:12px', text: `${fmtDate(h.date)} ${fmtTime(h.capturedAt)}` }),
          ]),
          el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:5px' },
            [h.categories.join('、'), h.defectNo, h.field].filter(Boolean).join('　·　')),
          el('div', { style: 'line-height:1.7' }, highlight(h.text, words)),
          // 推論來的內容要標出來，不能跟他自己寫的字看起來一樣
          h.inferred ? el('span', { class: 'badge badge-unverified', style: 'margin-top:6px' }, 'AI 推論') : null,
        );
        list.append(card);
      }
    } catch (err) {
      status.textContent = '';
      toast(err.message, 5000);
    }
  };

  box.addEventListener('input', debounce(run, 200));
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); run(); } });
  projSel.addEventListener('change', run);
  catSel.addEventListener('change', run);

  await run();
  return wrap;
}
