// 最小限のZIP読み書き（.docx / .xlsx 用）。
// ブラウザとNode.jsの両方で動くよう、標準の CompressionStream / DecompressionStream だけを使う。

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function streamThrough(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const inflateRaw = (b) => streamThrough(b, new DecompressionStream('deflate-raw'));
const deflateRaw = (b) => streamThrough(b, new CompressionStream('deflate-raw'));

const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8');

/** ZIPを読み込み、{ ファイル名: Uint8Array } を返す */
export async function readZip(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // 末尾の End Of Central Directory を探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP形式のファイルではありません');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIPの構造が壊れています');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8d.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    if (!name.endsWith('/')) {
      if (method === 0) files[name] = raw.slice();
      else if (method === 8) files[name] = await inflateRaw(raw);
      else throw new Error('未対応の圧縮形式です: ' + name);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** { ファイル名: Uint8Array | string } からZIPを作る */
export async function writeZip(files, order) {
  const names = order || Object.keys(files);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    let data = files[name];
    if (typeof data === 'string') data = utf8.encode(data);
    const nameBytes = utf8.encode(name);
    const crc = crc32(data);
    // 画像など既に圧縮済みのものは無圧縮で格納（速くて安全）
    const store = /\.(png|jpe?g|gif|wdp)$/i.test(name);
    const comp = store ? data : await deflateRaw(data);
    const method = store ? 0 : 8;
    const lh = new Uint8Array(30 + nameBytes.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true); // UTF-8 ファイル名
    l.setUint16(8, method, true);
    l.setUint16(10, 0, true);
    l.setUint16(12, 0x21, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, comp.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    chunks.push(lh, comp);
    const ch = new Uint8Array(46 + nameBytes.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, comp.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);
    offset += lh.length + comp.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, names.length, true);
  e.setUint16(10, names.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of [...chunks, ...central, end]) { out.set(x, p); p += x.length; }
  return out;
}

export const textOf = (bytes) => utf8d.decode(bytes);
