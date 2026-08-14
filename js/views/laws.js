// 法規查詢。查到的是條文原文，判斷仍然是他自己做。

import { el, append, setTitle, input, toast, debounce } from '../ui.js';
import { searchLaws, lawPackInfo, highlight, fmtLawDate } from '../laws.js';

export default async function laws() {
  setTitle('查法規');
  const wrap = el('div');

  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const box = input({ placeholder: '例：保護層、動火作業、停工', value: query.get('q') || '' });
  box.setAttribute('enterkeyhint', 'search');

  const scopeSel = el('select', {}, [el('option', { value: '' }, '全部法規')]);
  const status = el('div', { class: 'muted', style: 'margin:10px 0' });
  const list = el('div');

  wrap.append(el('div', { class: 'card' }, [
    el('h2', { text: '查法規' }),
    box,
    el('div', { style: 'height:10px' }),
    scopeSel,
    status,
  ]), list);

  // 版本資訊。法規會修訂，這一段不能省。
  let info;
  try {
    info = await lawPackInfo();
  } catch (err) {
    status.textContent = '';
    list.append(el('div', { class: 'notice warn' }, err.message));
    return wrap;
  }

  for (const l of info.laws) {
    scopeSel.append(el('option', { value: l.name }, `${l.name}（${l.count} 條）`));
  }

  const run = async () => {
    const q = box.value.trim();
    list.replaceChildren();
    if (!q) { status.textContent = `${info.laws.length} 部法規、${info.articles} 條，可離線查`; return; }

    status.textContent = '查詢中…';
    try {
      const name = scopeSel.value;
      const { hits, total, words } = await searchLaws(q);
      const shown = name ? hits.filter((h) => h.law === name) : hits;
      status.textContent = total
        ? `找到 ${total} 條${total > shown.length ? `，顯示 ${shown.length} 條` : ''}`
        : '沒有找到，換個詞試試';

      for (const h of shown) {
        const card = el('div', { class: 'card' });
        append(card,
          el('div', { class: 'row', style: 'gap:8px;margin-bottom:6px' }, [
            el('strong', { text: h.law }),
            el('span', { class: 'spacer' }),
            el('span', { class: 'muted', style: 'font-size:12px', text: `修正 ${fmtLawDate(h.updated)}` }),
          ]),
          h.ch ? el('div', { class: 'muted', style: 'font-size:12px', text: h.ch }) : null,
          el('div', { style: 'font-weight:700;margin:4px 0' }, highlight(h.no, words)),
          el('div', { style: 'white-space:pre-wrap;line-height:1.75' }, highlight(h.text, words)),
          el('a', {
            href: h.url, target: '_blank', rel: 'noopener',
            class: 'btn ghost sm', style: 'margin-top:10px',
          }, '到全國法規資料庫核對'),
        );
        list.append(card);
      }
    } catch (err) {
      status.textContent = '';
      toast(err.message, 5000);
    }
  };

  box.addEventListener('input', debounce(run, 250));
  scopeSel.addEventListener('change', run);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); box.blur(); run(); } });

  await run();

  // 這一段留著：法規會修訂，而過期的條文看起來一樣權威
  wrap.append(el('div', { class: 'notice warn', style: 'margin-top:16px' },
    `資料版本 ${fmtLawDate(info.dataDate)}。引用前請按條文下方連結核對現行條文。`));
  wrap.append(el('p', { class: 'muted', style: 'margin-top:8px;font-size:12px' },
    `${info.source}。不含 CNS 國家標準與施工綱要規範。`));

  return wrap;
}
