// 送出前預覽。任何要把資料送到 Gemini 的動作都必須先過這一關。
//
// 目的很單純：讓使用者永遠看得到自己到底送了什麼字出去，沒有黑箱。

import { el } from './ui.js';
import { prepareForUpload } from './redact.js';
import { getSetting } from './db.js';

/**
 * @param {string} rawText 還沒去識別化的原文
 * @param {{ title?: string, extraNote?: string, audioNote?: string }} opts
 * @returns {Promise<string|null>} 使用者確認後回傳「實際要送出的文字」，取消回傳 null
 */
export async function confirmUpload(rawText, opts = {}) {
  const { text, aliasHits, sensitiveHits } = await prepareForUpload(rawText);
  const tier = await getSetting('geminiTier', 'free');

  const dlg = el('dialog');
  const body = el('div');

  body.append(el('h2', { text: opts.title || '確認要送出的內容' }));

  if (tier !== 'paid') {
    body.append(el('div', { class: 'notice warn' }, [
      el('strong', { text: '目前是免費層' }),
      '送出的內容可能被 Google 用於改善產品，也可能被人工審閱。',
    ]));
  }

  if (opts.audioNote) {
    body.append(el('div', { class: 'notice danger' }, [
      el('strong', { text: '這次會上傳錄音檔本身' }),
      opts.audioNote,
    ]));
  }

  if (sensitiveHits.length) {
    body.append(el('div', { class: 'notice danger' }, [
      el('strong', { text: `偵測到 ${sensitiveHits.length} 個敏感詞還在內容裡` }),
      sensitiveHits.join('、'),
      el('div', { style: 'margin-top:4px' },
        '可以到「設定 → 代號對照表」加一組替換，或直接改掉下面的文字。'),
    ]));
  }

  if (aliasHits.length) {
    body.append(el('div', { class: 'notice info' }, [
      el('strong', { text: '已自動替換' }),
      aliasHits.join('、'),
    ]));
  }

  body.append(el('p', { class: 'muted', style: 'margin:12px 0 6px' },
    '以下是實際會離開這台裝置的文字，你可以直接在這裡修改：'));

  const ta = el('textarea', { style: 'min-height:180px' });
  ta.value = text;
  body.append(ta);

  if (opts.extraNote) {
    body.append(el('p', { class: 'muted', style: 'margin-top:8px' }, opts.extraNote));
  }

  const cancel = el('button', { class: 'btn ghost', type: 'button', text: '取消' });
  const send = el('button', { class: 'btn', type: 'button', text: '確認送出' });
  body.append(el('menu', {}, [cancel, send]));

  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();

  return new Promise((resolve) => {
    let result = null;
    const close = () => { dlg.close(); };
    cancel.addEventListener('click', close);
    send.addEventListener('click', () => { result = ta.value; close(); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    }, { once: true });
  });
}

/** 上傳錄音之前的確認。文字部分只有提示，音訊本身無法預覽內容。 */
export async function confirmAudioUpload(seconds) {
  return confirmUpload('', {
    title: '要把這段錄音送到 Gemini 嗎？',
    audioNote: `整段 ${Math.round(seconds)} 秒的音訊都會上傳。`
      + '如果錄到了別人講話、或提到不該外流的名字，請改用 iOS 鍵盤聽寫自己打。',
    extraNote: '上面的文字框可以留空，它只是給你補充說明用的（會一起送出）。',
  });
}
