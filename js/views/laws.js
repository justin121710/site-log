// 法規查詢。查到的是條文原文，判斷仍然是他自己做。

import { el, append, setTitle, input, toast, debounce } from '../ui.js';
import { searchLaws, lawPackInfo, searchSpecs, specInfo, highlight, fmtLawDate } from '../laws.js';
import { getSetting } from '../db.js';
import { categoryName, seedSubtags } from '../taxonomy.js';

/** 下拉選單裡「只看施工綱要規範」那一項的值。用不可能跟法規名稱撞名的字串。 */
const SPEC_ONLY = '#spec';

export default async function laws() {
  setTitle('查法規');
  const wrap = el('div');

  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  // 範例只放「一定查得到」的詞。拿保護層當範例是在教人踩空——
  // 它是屬性不是工項，章名與法條裡都沒有這三個字。
  const box = input({ placeholder: '例：鋼筋、模板、護欄', value: query.get('q') || '' });
  box.setAttribute('enterkeyhint', 'search');

  const scopeSel = el('select', {}, [el('option', { value: '' }, '全部（法規＋施工綱要規範）')]);
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

  const spec = await specInfo().catch(() => null);

  // 施工綱要規範要出現在這張清單裡。這個下拉選單就是「這裡面有什麼」的說明，
  // 不列進來的話，除非有人告訴他，否則他不會知道規範章節也查得到。
  if (spec) scopeSel.append(el('option', { value: SPEC_ONLY }, `施工綱要規範（${spec.count} 章）`));
  for (const l of info.laws) {
    scopeSel.append(el('option', { value: l.name }, `${l.name}（${l.count} 條）`));
  }

  // 子項表：保護層、續接位置這種「屬性」不會出現在章名裡，但它們在 App 裡
  // 本來就掛在某個工項底下。查不到時用這張表告訴他該改搜哪個詞——
  // 這是既有資料，不是我另外編的對照表。
  const subtagTable = await getSetting('subtags', seedSubtags());
  const categoryOfTerm = (word) => {
    for (const [catId, list] of Object.entries(subtagTable || {})) {
      if ((list || []).some((s) => s === word)) return categoryName(catId);
    }
    return null;
  };

  /**
   * 施工綱要規範只有章名，查到就是告訴他「去翻哪一章」，內文要自己去工程會下載。
   * @returns {Promise<number>} 命中的章數
   */
  async function renderSpecs(q) {
    if (!spec) return 0;
    const { hits, words } = await searchSpecs(q);

    if (!hits.length) {
      // 查不到時，若這個詞是某個工項的子項，就給他一條路走下去
      for (const w of words) {
        const cat = categoryOfTerm(w);
        if (!cat) continue;
        const again = el('a', { href: '#', class: 'btn ghost sm' }, `改搜「${cat}」`);
        again.addEventListener('click', (ev) => { ev.preventDefault(); box.value = cat; run(); });
        const card = el('div', { class: 'card' });
        append(card,
          el('div', { class: 'muted', style: 'margin-bottom:8px' },
            `施工綱要規範的章名裡沒有「${w}」，它在 App 裡屬於「${cat}」工項。`),
          again);
        list.append(card);
        return 0;
      }
      return 0;
    }
    const card = el('div', { class: 'card' });
    append(card,
      el('div', { class: 'row', style: 'gap:8px;margin-bottom:8px' }, [
        el('strong', { text: '施工綱要規範' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted', style: 'font-size:12px', text: `${hits.length} 章` }),
      ]),
      ...hits.map((h) => el('div', { class: 'row', style: 'gap:10px;padding:5px 0' }, [
        el('code', { style: 'font-weight:700;min-width:4.2em' }, h.code),
        el('span', {}, highlight(h.name, words)),
        el('span', { class: 'spacer' }),
        h.ver ? el('span', { class: 'muted', style: 'font-size:12px', text: h.ver }) : null,
      ])),
      el('a', {
        href: spec.listUrl, target: '_blank', rel: 'noopener',
        class: 'btn ghost sm', style: 'margin-top:10px',
      }, '到工程會下載這幾章'),
    );
    list.append(card);
    return hits.length;
  }

  const run = async () => {
    const q = box.value.trim();
    const scope = scopeSel.value;
    list.replaceChildren();

    if (!q) {
      status.textContent = `${info.laws.length} 部法規 ${info.articles} 條`
        + (spec ? `、施工綱要規範 ${spec.count} 章` : '')
        + '，可離線查';
      return;
    }

    status.textContent = '查詢中…';
    try {
      // 選了單一部法規時就不要再插規範章節，他已經指定要看哪一本了
      const specCount = scope === '' || scope === SPEC_ONLY ? await renderSpecs(q) : 0;

      if (scope === SPEC_ONLY) {
        status.textContent = specCount ? `找到 ${specCount} 章` : '沒有找到，換個詞試試';
        return;
      }

      const { hits, total, words } = await searchLaws(q);
      const shown = scope ? hits.filter((h) => h.law === scope) : hits;
      const lawPart = total
        ? `找到 ${total} 條${total > shown.length ? `，顯示 ${shown.length} 條` : ''}`
        : '法規沒有找到';
      status.textContent = specCount ? `規範 ${specCount} 章、${lawPart}` : lawPart;

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
  append(wrap, el('p', { class: 'muted', style: 'margin-top:8px;font-size:12px' },
    `${info.source}。不含 CNS 國家標準。`),
  spec ? el('p', { class: 'muted', style: 'margin-top:4px;font-size:12px' },
    `施工綱要規範只有章碼與章名（${spec.count} 章，${spec.fetchedAt}），內文請到工程會下載。`
    + `出處：${spec.source}，${spec.license}。`) : null);

  return wrap;
}
