// 共用 UI 小工具。刻意不引入任何框架：GitHub Pages 直接吃靜態檔，沒有 build step。

/**
 * 把值轉成要顯示的字串，並攔掉字面上的 "null" / "undefined"。
 *
 * 這是最後一道防線。上游任何一處漏了防呆（例如 `${a}${b}` 而 a、b 是 null），
 * 使用者看到的會是「nullnull」——在一份要交出去的監造表報上，那比空白糟得多。
 * 攔掉但同時在主控台留紀錄，這樣它仍然查得出來，只是不會被印出去。
 */
function displayText(v) {
  const s = String(v);
  if (!/null|undefined/.test(s)) return s;
  // \b 兩側的邊界確保只清掉獨立成詞的 null／undefined，
  // 「nullable」這種正常的字不會被動到。
  const cleaned = s.replace(/\b(?:null|undefined)+\b/g, '');
  if (cleaned !== s) console.warn('[ui] 攔下空值文字：', s);
  return cleaned;
}

/** 建立元素。children 可為字串、節點、或陣列。 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = displayText(v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(displayText(c)));
  }
  return node;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const node = document.getElementById('toast');
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}

/** 破壞性動作前的確認。body 可為字串或節點。 */
export function confirmDialog({ title, body = '', okLabel = '確定', danger = true }) {
  const dlg = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = title;
  const bodyNode = document.getElementById('confirm-body');
  bodyNode.replaceChildren(body instanceof Node ? body : el('p', { text: body, class: 'muted' }));
  const ok = document.getElementById('confirm-ok');
  ok.textContent = okLabel;
  ok.className = danger ? 'btn danger' : 'btn';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

// ---------- 日期時間 ----------

/** 本地時區的 YYYY-MM-DD。不能用 toISOString()，那是 UTC，跨日會錯一天。 */
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${dateStr}（${WEEKDAYS[d.getDay()]}）`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtDuration(sec) {
  if (!sec && sec !== 0) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- 表單 ----------

export function field(label, input, hint = '') {
  return el('label', { class: 'field' }, [
    el('span', { text: label }),
    input,
    hint ? el('div', { class: 'muted', text: hint, style: 'margin-top:4px' }) : null,
  ]);
}

export function input(attrs = {}) {
  return el('input', { type: 'text', ...attrs });
}

export function textarea(attrs = {}) {
  return el('textarea', attrs);
}

/** 綁一組欄位到物件上，輸入即寫回（不自動存檔，由呼叫端決定何時存）。 */
export function bind(node, obj, key, onChange) {
  node.value = obj[key] ?? '';
  node.addEventListener('input', () => {
    obj[key] = node.value;
    onChange?.();
  });
  return node;
}

/** 存檔前先跑一次，避免 iOS 上使用者還在輸入法組字時值沒同步。 */
export function flushActiveInput() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur();
}

export function setTitle(text) {
  document.getElementById('title').textContent = text;
}

/** debounce，用在自動存檔。 */
export function debounce(fn, ms = 500) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
