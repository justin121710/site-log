// 匯出對話框。專案頁、某一天、設定頁共用同一個，才不會三個地方各講各的。

import { el, toast, fmtBytes } from './ui.js';
import { exportBackup, exportMarkdown, markdownText } from './export.js';

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

    el('div', { class: 'notice info' }, [
      el('strong', { text: '完整備份' }),
      '原始 JSON + 照片錄音原檔。手機掛掉時要靠這一份救回來，請定期做。',
    ]),
    backupBtn,

    el('div', { class: 'notice info', style: 'margin-top:14px' }, [
      el('strong', { text: 'Markdown' }),
      'Notion 左下角 Settings → Import → Markdown & CSV，直接選匯出的 zip，照片會一起進去。'
      + '這是給你自己讀的版本，不能當備份用。',
    ]),
    el('div', { class: 'notice warn' }, [
      el('strong', { text: 'Notion 是第三方雲端服務' }),
      '匯進去等於整包工地資料離開這台裝置。標題與檔名會用專案代號而不是真實案名，'
      + '但照片與內文是原樣。要放什麼進去請自己判斷。',
    ]),
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
