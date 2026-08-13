// 從 JPEG 讀 GPS。只讀，不寫。
//
// 為什麼需要這個：normalizePhoto() 會用 canvas 重新編碼縮圖，
// 那會把所有 EXIF 砍光。所以要在縮圖之前先把座標撈出來另外存。
//
// 重要限制（iOS）：
//   - 用相機「直拍」（input capture）拿到的照片，iOS 不會附 GPS EXIF。這是 Apple 的
//     隱私設計，沒有辦法繞過，只能改用 navigator.geolocation。
//   - 從「相簿」選的照片通常保留 GPS，但 HEIC 被轉成 JPEG 時可能掉。
// 所以這個函式回 null 是很正常的事，呼叫端不能把它當錯誤。

const JPEG_SOI = 0xffd8;
const APP1 = 0xffe1;

/**
 * @param {Blob} blob
 * @returns {Promise<{lat: number, lng: number, source: 'exif'}|null>}
 */
export async function readGpsFromJpeg(blob) {
  try {
    // GPS IFD 一定在檔案前段，讀 256KB 綽綽有餘，不必把整張圖載進來
    const head = blob.slice(0, Math.min(blob.size, 256 * 1024));
    const buf = await head.arrayBuffer();
    const dv = new DataView(buf);
    if (dv.byteLength < 4 || dv.getUint16(0) !== JPEG_SOI) return null;

    let off = 2;
    while (off + 4 < dv.byteLength) {
      const marker = dv.getUint16(off);
      const size = dv.getUint16(off + 2);
      if ((marker & 0xff00) !== 0xff00) return null;
      if (marker === APP1) {
        const start = off + 4;
        // "Exif\0\0"
        if (dv.getUint32(start) === 0x45786966) return parseTiff(dv, start + 6);
      }
      off += 2 + size;
    }
  } catch {
    // 壞掉的 EXIF 不該讓拍照流程掛掉，安靜地當作沒有座標
  }
  return null;
}

function parseTiff(dv, base) {
  if (base + 8 > dv.byteLength) return null;
  const le = dv.getUint16(base) === 0x4949; // "II" = little endian
  if (!le && dv.getUint16(base) !== 0x4d4d) return null;
  if (dv.getUint16(base + 2, le) !== 42) return null;

  const ifd0 = base + dv.getUint32(base + 4, le);
  const gpsOffset = findTag(dv, base, ifd0, 0x8825, le);
  if (gpsOffset === null) return null;

  const gpsIfd = base + gpsOffset;
  const latRef = readAscii(dv, base, gpsIfd, 0x0001, le);
  const lat = readRational3(dv, base, gpsIfd, 0x0002, le);
  const lngRef = readAscii(dv, base, gpsIfd, 0x0003, le);
  const lng = readRational3(dv, base, gpsIfd, 0x0004, le);
  if (lat === null || lng === null) return null;

  const latVal = toDegrees(lat) * (latRef === 'S' ? -1 : 1);
  const lngVal = toDegrees(lng) * (lngRef === 'W' ? -1 : 1);
  if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return null;
  if (latVal === 0 && lngVal === 0) return null; // 相機沒定位到時常見的假值

  return { lat: +latVal.toFixed(6), lng: +lngVal.toFixed(6), source: 'exif' };
}

function eachEntry(dv, ifd, le, fn) {
  if (ifd + 2 > dv.byteLength) return;
  const n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > dv.byteLength) return;
    const r = fn(dv.getUint16(e, le), dv.getUint16(e + 2, le), dv.getUint32(e + 4, le), e + 8);
    if (r !== undefined) return r;
  }
}

function findTag(dv, base, ifd, tag, le) {
  let found = null;
  eachEntry(dv, ifd, le, (t, type, count, valueOff) => {
    if (t === tag) { found = dv.getUint32(valueOff, le); return true; }
    void type; void count;
  });
  return found;
}

function readAscii(dv, base, ifd, tag, le) {
  let out = null;
  eachEntry(dv, ifd, le, (t, type, count, valueOff) => {
    if (t !== tag) return;
    // 4 bytes 以內直接放在欄位裡，超過才是偏移量
    const p = count <= 4 ? valueOff : base + dv.getUint32(valueOff, le);
    if (p < dv.byteLength) out = String.fromCharCode(dv.getUint8(p)).trim();
    return true;
  });
  return out;
}

/** GPS 的度分秒是三個 rational（各 8 bytes），一定放在偏移量指到的地方。 */
function readRational3(dv, base, ifd, tag, le) {
  let out = null;
  eachEntry(dv, ifd, le, (t, type, count, valueOff) => {
    if (t !== tag || count < 3) return;
    const p = base + dv.getUint32(valueOff, le);
    if (p + 24 > dv.byteLength) return true;
    const r = [];
    for (let i = 0; i < 3; i++) {
      const num = dv.getUint32(p + i * 8, le);
      const den = dv.getUint32(p + i * 8 + 4, le);
      r.push(den === 0 ? 0 : num / den);
    }
    out = r;
    return true;
  });
  return out;
}

function toDegrees([d, m, s]) {
  return d + m / 60 + s / 3600;
}
