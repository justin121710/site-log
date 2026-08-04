// 相機、錄音、GPS。全部在裝置上跑，這一層沒有任何網路呼叫。

// 原圖直接存的話，一支 iPhone 拍幾百張就好幾 GB，瀏覽器配額撐不住。
// 2048px 長邊對「看得出鋼筋間距、螺栓顆數」還是夠的。
const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/**
 * 開相機拍照。用 <input capture> 而不是 getUserMedia：
 * iOS 上前者拿得到原生相機的完整畫質與對焦，後者在 PWA 裡常常出狀況。
 * @returns {Promise<File[]>}
 */
export function pickPhotos({ camera = true, multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (camera) inp.capture = 'environment';
    if (multiple) inp.multiple = true;
    inp.style.display = 'none';
    document.body.append(inp);
    inp.addEventListener('change', () => {
      const files = [...(inp.files || [])];
      inp.remove();
      resolve(files);
    }, { once: true });
    // 使用者按取消時 change 不會觸發，input 就留著等下次 GC；不影響功能。
    inp.click();
  });
}

/** 縮圖並轉成 JPEG。回傳 { blob, width, height }。 */
export async function normalizePhoto(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // 有些 HEIC 在部分瀏覽器解不開，原檔存起來總比丟掉好
    return { blob: file, width: null, height: null };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  return { blob: blob || file, width: w, height: h };
}

/** 取一次 GPS。地下室通常拿不到，所以失敗一律當作沒有，不擋流程。 */
export function getGPS({ timeout = 6000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        acc: Math.round(pos.coords.accuracy),
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

// ---------- 錄音 ----------

/** 挑一個這台裝置真的支援的容器。iOS Safari 只給 audio/mp4。 */
function pickMime() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  }
  return '';
}

export function isRecordingSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/**
 * 前景短錄。iOS 會在螢幕鎖定或切到別的 App 時暫停 PWA，錄音會斷，
 * 所以 UI 那邊要提醒使用者「螢幕開著、講完就放」。
 */
export class Recorder {
  constructor({ onTick } = {}) {
    this.onTick = onTick;
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.timer = null;
    this.startedAt = 0;
  }

  get recording() {
    return this.rec?.state === 'recording';
  }

  async start() {
    if (!isRecordingSupported()) throw new Error('這個瀏覽器不支援錄音');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).catch(() => { throw new Error('拿不到麥克風權限，請到 Safari 設定裡允許'); });

    const mimeType = pickMime();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start();
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.onTick?.(this.elapsed()), 250);
  }

  elapsed() {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  /** @returns {Promise<{blob: Blob, mime: string, duration: number}|null>} */
  stop() {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve(null);
      const duration = this.elapsed();
      this.rec.addEventListener('stop', () => {
        clearInterval(this.timer);
        this.stream?.getTracks().forEach((t) => t.stop());
        const mime = this.rec.mimeType || 'audio/mp4';
        const blob = new Blob(this.chunks, { type: mime });
        this.stream = null;
        this.rec = null;
        this.chunks = [];
        resolve(blob.size ? { blob, mime, duration } : null);
      }, { once: true });
      this.rec.stop();
    });
  }

  cancel() {
    clearInterval(this.timer);
    try { this.rec?.stop(); } catch { /* 已經停了 */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.chunks = [];
  }
}

/** 匯入 iOS 語音備忘錄或其他音檔。 */
export function pickAudio() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*';
    inp.style.display = 'none';
    document.body.append(inp);
    inp.addEventListener('change', () => {
      const files = [...(inp.files || [])];
      inp.remove();
      resolve(files);
    }, { once: true });
    inp.click();
  });
}

/** 讀音檔長度。拿不到就回 null，不擋流程。 */
export function audioDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.addEventListener('loadedmetadata', () => {
      done(Number.isFinite(a.duration) ? a.duration : null);
    }, { once: true });
    a.addEventListener('error', () => done(null), { once: true });
    a.src = url;
    setTimeout(() => done(null), 4000);
  });
}
