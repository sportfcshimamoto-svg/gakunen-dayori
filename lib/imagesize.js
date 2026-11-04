// 画像ファイル（PNG / JPEG）の縦横ピクセル数を読む
export function imageSize(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p < b.length) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      const len = (b[p + 2] << 8) | b[p + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', height: (b[p + 5] << 8) | b[p + 6], width: (b[p + 7] << 8) | b[p + 8] };
      }
      p += 2 + len;
    }
  }
  throw new Error('PNGまたはJPEGの画像を使ってください');
}
