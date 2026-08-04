// 極簡 ZIP 產生器（只用 STORE，不壓縮）。
//
// 為什麼不壓縮：備份內容幾乎都是 JPEG 與 AAC，本來就壓過了，再壓省不到空間，
// 卻要在手機上多花一大段 CPU。為什麼不用 JSZip：這個 App 刻意零外部相依，
// 才能在工地離線也一定跑得起來。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

class Writer {
  constructor(size) {
    this.buf = new DataView(new ArrayBuffer(size));
    this.pos = 0;
  }
  u16(v) { this.buf.setUint16(this.pos, v, true); this.pos += 2; }
  u32(v) { this.buf.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  bytes(u8) { new Uint8Array(this.buf.buffer, this.pos, u8.length).set(u8); this.pos += u8.length; }
  done() { return new Uint8Array(this.buf.buffer, 0, this.pos); }
}

/**
 * @param {{name: string, blob: Blob}[]} files 檔名用 / 當資料夾分隔
 * @returns {Promise<Blob>}
 */
export async function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const { name, blob } of files) {
    const nameBytes = enc.encode(name);
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(u8);
    const size = u8.length;

    if (size > 0xffffffff) throw new Error(`檔案太大無法打包：${name}`);

    const lh = new Writer(30 + nameBytes.length);
    lh.u32(0x04034b50);
    lh.u16(20);        // version needed
    lh.u16(0x0800);    // 檔名用 UTF-8
    lh.u16(0);         // method = store
    lh.u16(time);
    lh.u16(date);
    lh.u32(crc);
    lh.u32(size);
    lh.u32(size);
    lh.u16(nameBytes.length);
    lh.u16(0);
    lh.bytes(nameBytes);

    parts.push(lh.done(), blob);

    const ch = new Writer(46 + nameBytes.length);
    ch.u32(0x02014b50);
    ch.u16(20);        // version made by
    ch.u16(20);        // version needed
    ch.u16(0x0800);
    ch.u16(0);
    ch.u16(time);
    ch.u16(date);
    ch.u32(crc);
    ch.u32(size);
    ch.u32(size);
    ch.u16(nameBytes.length);
    ch.u16(0);         // extra
    ch.u16(0);         // comment
    ch.u16(0);         // disk start
    ch.u16(0);         // internal attrs
    ch.u32(0);         // external attrs
    ch.u32(offset);    // local header offset
    ch.bytes(nameBytes);
    central.push(ch.done());

    offset += lh.pos + size;
    if (offset > 0xffffffff) throw new Error('備份超過 4GB，請分批匯出');
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Writer(22);
  eocd.u32(0x06054b50);
  eocd.u16(0);
  eocd.u16(0);
  eocd.u16(files.length);
  eocd.u16(files.length);
  eocd.u32(cdSize);
  eocd.u32(offset);
  eocd.u16(0);

  return new Blob([...parts, ...central, eocd.done()], { type: 'application/zip' });
}
