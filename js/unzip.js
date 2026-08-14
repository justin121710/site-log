// 極簡 ZIP 讀取器，跟 zip.js 是一對。
//
// 只讀目錄，不把整包載進記憶體：每個檔案回傳的是 file.slice() 切出來的 Blob，
// 還指向原檔在磁碟上的那一段。一包幾百 MB 的備份在手機上才打得開。
//
// STORE（我們自己產的）直接切就好；如果檔案在電腦上被解開又重壓成 DEFLATE，
// 用瀏覽器內建的 DecompressionStream 解，一樣不需要外部套件。

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * @param {Blob|File} file
 * @returns {Promise<{ names: string[], has(name): boolean, blob(name, mime?): Promise<Blob>, text(name): Promise<string>, json(name): Promise<any> }>}
 */
export async function openZip(file) {
  const entries = await readCentralDirectory(file);
  const byName = new Map(entries.map((e) => [e.name, e]));
  // 在 Windows 上重壓過的 zip，中文檔名可能不是 UTF-8。退而求其次用檔名的最後一段對。
  const byBase = new Map(entries.map((e) => [e.name.split('/').pop(), e]));

  const find = (name) => byName.get(name) || byBase.get(name.split('/').pop()) || null;

  return {
    names: entries.map((e) => e.name),
    has: (name) => !!find(name),
    async blob(name, mime = '') {
      const e = find(name);
      if (!e) throw new Error(`備份裡找不到 ${name}`);
      return readEntry(file, e, mime);
    },
    async text(name) {
      return (await this.blob(name)).text();
    },
    async json(name) {
      const raw = await this.text(name);
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`${name} 不是合法的 JSON，這包備份可能壞了`);
      }
    },
  };
}

async function readCentralDirectory(file) {
  // EOCD 在檔尾，後面最多再跟 64KB 的註解
  const tailLen = Math.min(file.size, 66 * 1024);
  if (tailLen < 22) throw new Error('這不是 zip 檔');
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('這不是 zip 檔，或檔案不完整');

  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw new Error('不支援 ZIP64 格式的備份');

  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const entries = [];
  let p = 0;

  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== CD_SIG) break;
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    entries.push({
      name: dec.decode(nameBytes),
      method: cd.getUint16(p + 10, true),
      csize: cd.getUint32(p + 20, true),
      size: cd.getUint32(p + 24, true),
      offset: cd.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!entries.length) throw new Error('這包 zip 是空的');
  return entries;
}

async function readEntry(file, entry, mime) {
  // local header 的檔名與 extra 長度不一定跟 central directory 一樣，資料位置要從它算
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (head.getUint32(0, true) !== LOCAL_SIG) throw new Error(`${entry.name} 的位置對不上，檔案可能壞了`);
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = file.slice(start, start + entry.csize);

  if (entry.method === 0) return mime ? raw.slice(0, raw.size, mime) : raw;

  if (entry.method === 8) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('這個瀏覽器解不開壓縮過的 zip，請用 App 匯出的原始備份檔');
    }
    const out = await new Response(
      raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))
    ).blob();
    return mime ? out.slice(0, out.size, mime) : out;
  }

  throw new Error(`${entry.name} 用了不支援的壓縮方式`);
}
