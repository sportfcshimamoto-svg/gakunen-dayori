// 写真の保存と加工。写真はこのブラウザの中（IndexedDB）にだけ保存し、インターネットには送らない。
const DB_NAME = 'gakunen-dayori-photos';
const STORE = 'photos';
const MAX_SIDE = 1600;      // 長い辺をこのピクセル数まで小さくする（印刷には十分で、Wordが重くならない）
const QUALITY = 0.85;

let dbPromise = null;
const memory = new Map();   // IndexedDB が使えないときの予備（ページを閉じると消える）
let useMemory = false;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { useMemory = true; throw e; });
  }
  return dbPromise;
}
async function tx(mode, fn) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode); const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  } catch (e) {
    if (!useMemory) throw e;
    return undefined;
  }
}

/** 保存できる場所があるか（false のときは、ページを閉じると写真が消える） */
export async function isPersistent() { try { await openDb(); return true; } catch { return false; } }

export async function putPhoto(rec) { if (useMemory) { memory.set(rec.id, rec); return; } await tx('readwrite', (s) => s.put(rec)); }
export async function getPhoto(id) { if (useMemory) return memory.get(id); return tx('readonly', (s) => s.get(id)); }
export async function deletePhoto(id) { if (useMemory) { memory.delete(id); return; } await tx('readwrite', (s) => s.delete(id)); }
export async function allPhotos() { if (useMemory) return [...memory.values()]; return (await tx('readonly', (s) => s.getAll())) || []; }

export const newPhotoId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * 写真を読み込んで、向きを直し、ちょうどよい大きさのJPEGにする
 * @returns { id, name, blob, width, height, addedAt }
 */
export async function preparePhoto(file, { keepPng = false, id } = {}) {
  if (/\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type)) {
    throw new Error(`「${file.name}」はHEIC形式のため読み込めません。JPEG形式で保存し直してください（iPhoneの「設定 → カメラ → フォーマット → 互換性優先」でJPEGになります）。`);
  }
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`「${file.name}」は写真として読み込めませんでした（JPEGかPNGを使ってください）。`); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k); const h = Math.round(bmp.height * k);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  // イラストやロゴのPNGは、透明な部分を残すためPNGのままにする（keepPng）
  const png = keepPng && /png/i.test(file.type || file.name);
  const ctx = canvas.getContext('2d');
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((res) => canvas.toBlob(res, type, QUALITY));
  return { id: id || newPhotoId(), name: file.name, blob, type, width: w, height: h, addedAt: Date.now() };
}

// 保存ファイルに入れるときの変換
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBlob(b64, type = 'image/jpeg') {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}
