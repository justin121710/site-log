// 工項分類的單一分類：跨專案列出同一類的記錄，可以只看已確認的。

import { el, setTitle, fmtDate, fmtTime, toast, today, confirmDialog } from '../ui.js';
import {
  listEntriesByCategory, listProjects, listMedia, getSetting, setSetting,
  newEntry, saveEntry,
} from '../db.js';
import { categoryById, isCustomCategory, removeCategory } from '../taxonomy.js';
import { icon } from '../icons.js';

export default async function category({ catId }) {
  const cat = categoryById(catId);
  if (!cat) throw new Error('沒有這個分類');
  setTitle(cat.name);

  const wrap = el('div');
  const all = await listEntriesByCategory(catId);
  const projects = Object.fromEntries((await listProjects()).map((p) => [p.id, p]));

  let verifiedOnly = await getSetting('libVerifiedOnly', false);
  let subFilter = null;

  const filterBar = el('div', { class: 'card' });
  const list = el('div');

  const subtags = [...new Set(all.flatMap((e) => e.subtags))].sort();

  function renderFilters() {
    filterBar.replaceChildren();

    const only = el('input', { type: 'checkbox', style: 'width:22px;min-height:22px;flex:none' });
    only.checked = verifiedOnly;
    only.addEventListener('change', async () => {
      verifiedOnly = only.checked;
      await setSetting('libVerifiedOnly', verifiedOnly);
      renderList();
    });

    filterBar.append(el('label', { class: 'row', style: 'gap:10px;cursor:pointer' }, [
      only,
      el('span', { text: '只看已確認的（過濾掉未查證的 AI 內容）' }),
    ]));

    if (subtags.length) {
      const chips = el('div', { class: 'chips', style: 'margin-top:12px' });
      for (const s of subtags) {
        const b = el('button', {
          class: 'chip sm',
          type: 'button',
          'aria-pressed': String(subFilter === s),
          text: s,
        });
        b.addEventListener('click', () => {
          subFilter = subFilter === s ? null : s;
          renderFilters();
          renderList();
        });
        chips.append(b);
      }
      filterBar.append(chips);
    }
  }

  async function renderList() {
    let rows = all;
    if (verifiedOnly) rows = rows.filter((e) => e.verified || !e.ai);
    if (subFilter) rows = rows.filter((e) => e.subtags.includes(subFilter));

    list.replaceChildren();

    if (!rows.length) {
      list.append(el('div', { class: 'empty' }, [
        el('strong', { text: all.length ? '這個篩選沒有結果' : '這個分類還沒有東西' }),
      ]));
      return;
    }

    // 依專案分組，這樣 A 案場和 B 案場的做法可以直接對照
    const byProject = new Map();
    for (const e of rows) {
      const key = e.projectId || '';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(e);
    }

    for (const [pid, group] of byProject) {
      const p = projects[pid];
      const label = !pid ? '未歸專案（直接記在工項分類）'
        : p?.name || '（已刪除的專案）';
      list.append(el('h3', { style: 'margin:18px 0 8px;font-size:14px' }, [
        el('span', { text: label }),
        el('span', { class: 'muted', text: `　${group.length} 筆` }),
      ]));

      for (const e of group) {
        const media = await listMedia(e.id);
        const photo = media.find((m) => m.kind === 'photo');

        const thumb = el('div', {
          style: 'width:72px;height:72px;flex:none;border-radius:10px;overflow:hidden;color:var(--text-dim);'
            + 'background:var(--surface-2);display:flex;align-items:center;justify-content:center',
        });
        if (photo) {
          const url = URL.createObjectURL(photo.blob);
          const img = el('img', { src: url, style: 'width:100%;height:100%;object-fit:cover' });
          img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
          thumb.append(img);
        } else {
          thumb.append(icon('note', { size: 28 }));
        }

        const place = [e.floor, e.gridline, e.area].filter(Boolean).join(' · ');

        list.append(el('a', { href: `#/e/${e.id}`, class: 'card' }, [
          el('div', { class: 'row', style: 'align-items:flex-start;gap:12px' }, [
            thumb,
            el('div', { style: 'min-width:0;flex:1' }, [
              el('div', { class: 'row' }, [
                el('span', { class: 'muted mono', text: `${fmtDate(e.date)} ${fmtTime(e.capturedAt)}` }),
                el('span', { class: 'spacer' }),
                e.verified
                  ? el('span', { class: 'badge badge-verified', text: '已確認' })
                  : e.ai ? el('span', { class: 'badge badge-unverified', text: '未查證' }) : null,
              ]),
              place ? el('strong', { text: place, style: 'font-size:14px;display:block;margin-top:3px' }) : null,
              e.subtags.length
                ? el('div', { class: 'muted', style: 'margin-top:3px', text: e.subtags.join('、') })
                : null,
              el('div', {
                style: 'margin-top:4px;font-size:14px;display:-webkit-box;-webkit-line-clamp:3;'
                  + '-webkit-box-orient:vertical;overflow:hidden',
                text: e.ai?.tidied || e.transcript || e.note || '（沒有文字）',
              }),
            ]),
          ]),
        ]));
      }
    }
  }

  // 在這裡直接開一筆記錄，不綁任何專案。用在「這件事我想記進工項分類，
  // 但它不屬於我手上任何一個案子」——例如在別的工地看到的做法。
  const addBtn = el('button', { class: 'btn block', type: 'button', style: 'margin-bottom:12px' },
    [icon('plus'), `在「${cat.name}」新增一筆`]);
  addBtn.addEventListener('click', async () => {
    const e = newEntry(null, today());
    e.categoryIds = [catId];
    await saveEntry(e);
    location.hash = `#/e/${e.id}`;
  });

  renderFilters();
  await renderList();

  wrap.append(
    el('div', { class: 'row', style: 'gap:9px;margin-bottom:12px;color:var(--accent)' }, [
      icon(cat.icon, { size: 26 }),
      el('strong', { text: cat.name, style: 'font-size:18px' }),
    ]),
    addBtn,
    filterBar,
    list,
  );

  if (isCustomCategory(catId)) {
    const del = el('button', {
      class: 'btn ghost block',
      type: 'button',
      text: '刪除這個分類',
      style: 'margin-top:20px;color:var(--danger)',
    });
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `刪除「${cat.name}」？`,
        body: all.length
          ? `有 ${all.length} 筆記錄標了這個分類。記錄本身不會被刪，只會拿掉這個標記。`
          : '這個分類底下沒有記錄。',
        okLabel: '刪除分類',
      });
      if (!ok) return;
      const n = await removeCategory(catId);
      toast(n ? `已刪除，${n} 筆記錄的標記一併移除` : '已刪除');
      location.replace('#/lib'); // 分類沒了，歷史裡不能留著它的頁面
    });
    wrap.append(del);
  }

  return wrap;
}
