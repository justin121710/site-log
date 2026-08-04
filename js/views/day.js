// 某一天：當日工地資訊（一天填一次）＋ 當天所有記錄。

import { el, setTitle, fmtDate, fmtTime, field, input, toast, debounce, flushActiveInput } from '../ui.js';
import { get, listEntries, getOrCreateDay, saveDay, listMedia } from '../db.js';
import { categoryIcon, categoryName } from '../taxonomy.js';
import { icon } from '../icons.js';

export default async function day({ projectId, date }) {
  const p = await get('projects', projectId);
  if (!p) throw new Error('找不到這個專案');
  setTitle(fmtDate(date));

  const wrap = el('div');
  const d = await getOrCreateDay(projectId, date);

  wrap.append(el('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:12px' }, [
    el('a', { href: `#/p/${projectId}/new?date=${date}`, class: 'btn sm' }, [icon('plus', { size: 18 }), '新增記錄']),
    el('a', { href: `#/p/${projectId}/report/${date}`, class: 'btn ghost sm', text: '產生日報' }),
  ]));

  // ---------- 當日工地資訊 ----------
  const autosave = debounce(async () => {
    await saveDay(d);
    toast('已存當日資訊', 1200);
  }, 800);

  const mk = (key, label, attrs = {}) => {
    const node = input({ value: d[key] ?? '', ...attrs });
    node.addEventListener('input', () => { d[key] = node.value; autosave(); });
    return field(label, node);
  };

  const dayCard = el('details', { class: 'card' }, [
    el('summary', { style: 'font-weight:700;cursor:pointer;list-style:revert' }, '當日工地資訊'),
    el('p', { class: 'muted', style: 'margin:8px 0 12px' }, '一天填一次就好，會帶進日報。'),
    el('div', { class: 'grid2' }, [
      mk('weatherAM', '天氣（上午）', { placeholder: '晴／陰／雨' }),
      mk('weatherPM', '天氣（下午）', { placeholder: '晴／陰／雨' }),
    ]),
    mk('contractors', '在場廠商', { placeholder: '例：○○營造、鋼筋班、模板班' }),
    el('div', { class: 'grid2' }, [
      mk('manpower', '出工人數', { inputmode: 'numeric' }),
      mk('equipment', '主要機具', { placeholder: '例：吊車1、挖土機2' }),
    ]),
    el('div', { class: 'grid2' }, [
      mk('plannedProgress', '預定進度（%）', { inputmode: 'decimal' }),
      mk('actualProgress', '實際進度（%）', { inputmode: 'decimal' }),
    ]),
  ]);
  if (d.weatherAM || d.contractors || d.manpower) dayCard.open = true;
  wrap.append(dayCard);

  window.addEventListener('hashchange', () => { flushActiveInput(); saveDay(d); }, { once: true });

  // ---------- 記錄 ----------
  const entries = await listEntries(projectId, date);

  if (!entries.length) {
    wrap.append(el('div', { class: 'empty' }, [
      el('strong', { text: '這天還沒有記錄' }),
      el('p', { class: 'muted' }, '拍張照、按錄音講兩句，或直接打字都可以。'),
    ]));
    return wrap;
  }

  wrap.append(el('h3', { style: 'margin:18px 0 8px;font-size:14px;color:var(--text-dim)' },
    `${entries.length} 筆記錄`));

  for (const e of entries) {
    const media = await listMedia(e.id);
    const photo = media.find((m) => m.kind === 'photo');
    const audioCount = media.filter((m) => m.kind === 'audio').length;

    const thumb = el('div', {
      style: 'width:64px;height:64px;flex:none;border-radius:10px;overflow:hidden;color:var(--text-dim);'
        + 'background:var(--surface-2);display:flex;align-items:center;justify-content:center',
    });
    if (photo) {
      const url = URL.createObjectURL(photo.blob);
      const img = el('img', { src: url, style: 'width:100%;height:100%;object-fit:cover' });
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      thumb.append(img);
    } else {
      thumb.append(icon(audioCount ? 'waveform' : 'note', { size: 26 }));
    }

    const place = [e.floor, e.gridline, e.area].filter(Boolean).join(' · ');
    const cats = el('div', { class: 'row wrap', style: 'gap:4px 10px;margin-top:4px' },
      e.categoryIds.map((c) => el('span', { class: 'row muted', style: 'gap:4px' }, [
        icon(categoryIcon(c), { size: 15 }),
        categoryName(c),
      ])));

    wrap.append(el('a', { href: `#/e/${e.id}`, class: 'card' }, [
      el('div', { class: 'row', style: 'align-items:flex-start;gap:12px' }, [
        thumb,
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { class: 'row' }, [
            el('span', { class: 'muted mono', text: fmtTime(e.capturedAt) }),
            place ? el('strong', { text: place, style: 'font-size:14px' }) : null,
            el('span', { class: 'spacer' }),
            e.ai && !e.verified
              ? el('span', { class: 'badge badge-unverified', text: '未查證' })
              : e.verified ? el('span', { class: 'badge badge-verified', text: '已確認' }) : null,
          ]),
          e.categoryIds.length ? cats : null,
          el('div', {
            style: 'margin-top:4px;font-size:14px;display:-webkit-box;-webkit-line-clamp:2;'
              + '-webkit-box-orient:vertical;overflow:hidden',
            text: e.ai?.tidied || e.transcript || e.note || '（沒有文字）',
          }),
          media.length > 1 || audioCount
            ? el('div', { class: 'muted', style: 'margin-top:3px' },
              `${media.filter((m) => m.kind === 'photo').length} 張照片`
              + (audioCount ? `　${audioCount} 段錄音` : ''))
            : null,
        ]),
      ]),
    ]));
  }

  return wrap;
}
