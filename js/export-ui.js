// 匯出對話框。專案頁、某一天、設定頁共用同一個，才不會三個地方各講各的。

import { el, toast, fmtBytes } from './ui.js';
import { exportBackup, exportMarkdown, markdownText, shareTextFile } from './export.js';

/**
 * 產好報表之後怎麼交給使用者。
 *
 * 主路徑是「開啟」而不是「下載」：開起來之後就是一個普通網頁，
 * iOS 自己的分享鍵可以列印、存 PDF、傳給別人，比我做任何按鈕都好用。
 *
 * 為什麼要先產生再讓你點連結，而不是按一下就自動開：
 * window.open() 只要跨過 await 就會被瀏覽器當成程式自己彈窗擋掉。
 * 報表要先把照片轉成 data URI（非同步），所以自動開一定會被擋。
 * 給一個真的 <a> 讓使用者自己點，是唯一在 iOS 上穩的做法。
 */
export function presentReport({ html, filename, photos = 0 }) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const dlg = el('dialog');

  const openLink = el('a', {
    href: url,
    target: '_blank',
    rel: 'noopener',
    class: 'btn block',
    text: '開啟報表',
  });
  // 開起來之後這個對話框留著沒意義，但別馬上收掉 URL，新分頁還要用
  openLink.addEventListener('click', () => setTimeout(() => dlg.close(), 400));

  const shareBtn = el('button', { class: 'btn ghost block', type: 'button', text: '改成存成檔案' });
  shareBtn.addEventListener('click', async () => {
    try {
      await shareTextFile(html, filename);
      dlg.close();
    } catch (e) {
      toast(`存檔失敗：${e.message}`, 5000);
    }
  });

  const close = el('button', { class: 'btn ghost', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());

  dlg.append(el('div', {}, [
    el('h2', { text: '報表產好了' }),
    el('p', { class: 'muted', style: 'margin:-4px 0 12px' },
      `${filename}${photos ? `　含 ${photos} 張照片` : ''}　${fmtBytes(blob.size)}`),
    openLink,
    el('div', { style: 'height:10px' }),
    shareBtn,
    el('menu', {}, [close]),
  ]));

  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => {
    dlg.remove();
    // 新分頁載完才收，太早收會變成空白頁
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }, { once: true });
}

/**
 * @param {{ projectId?: string, date?: string, title: string }} scope
 */
export function exportDialog(scope) {
  const dlg = el('dialog');
  const status = el('div', { class: 'muted', style: 'margin-top:10px;min-height:1.5em' });

  const run = async (btn, label, fn) => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '處理中…';
    status.textContent = '打包中，照片多的話要等一下…';
    try {
      const r = await fn();
      status.textContent = r
        ? `完成：${r.entries} 筆記錄`
          + (r.media ? `、${r.media} 個檔案` : '')
          + (r.images ? `、${r.images} 張照片` : '')
          + `，共 ${fmtBytes(r.bytes)}`
        : '完成';
    } catch (e) {
      status.textContent = '';
      toast(`${label}失敗：${e.message}`, 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };

  const backupBtn = el('button', { class: 'btn block', type: 'button', text: '完整備份（.zip）' });
  backupBtn.addEventListener('click', () => run(backupBtn, '備份', () => exportBackup(scope)));

  const mdBtn = el('button', { class: 'btn ghost block', type: 'button', text: 'Markdown（給 Notion 匯入）' });
  mdBtn.addEventListener('click', () => run(mdBtn, '匯出', () => exportMarkdown(scope)));

  const copyBtn = el('button', { class: 'btn ghost block', type: 'button', text: '複製 Markdown 文字' });
  copyBtn.addEventListener('click', () => run(copyBtn, '複製', async () => {
    const text = await markdownText(scope);
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製，可以直接貼進 Notion');
    } catch {
      // iOS 在某些情況會擋剪貼簿，退回顯示讓他自己長按選取
      showText(text);
    }
    return null;
  }));

  const close = el('button', { class: 'btn ghost', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());

  dlg.append(el('div', {}, [
    el('h2', { text: `匯出：${scope.title}` }),

    backupBtn,
    el('div', { style: 'height:14px' }),
    // 這一句留著：Markdown 匯出就是資料真正要離開裝置的那一刻
    el('div', { class: 'notice warn' },
      'Markdown 匯出＝整包工地資料離開這台裝置。'),
    mdBtn,
    copyBtn,

    status,
    el('menu', {}, [close]),
  ]));

  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
}

function showText(text) {
  const dlg = el('dialog');
  const close = el('button', { class: 'btn ghost', type: 'button', text: '關閉' });
  close.addEventListener('click', () => dlg.close());
  dlg.append(el('h2', { text: '長按選取複製' }), el('pre', { text }), el('menu', {}, [close]));
  document.body.append(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
}
