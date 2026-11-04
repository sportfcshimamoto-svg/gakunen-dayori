// Excel（.xlsx）の読み込み。シートごとに「セル番地 → 値」を返す。
// 数式のセルは、Excelが最後に保存したときの計算結果を使う。
import { readZip, textOf } from './zip.js';

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function texts(xml) {
  // <t>…</t> をつなげる（ふりがな <rPh> は除く）
  return decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [])
    .map((t) => t.replace(/^<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, '')).join(''));
}

export function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // A=1
}

/** @returns {sheets: [{name, rows: Map<rowNo, Map<colLetters, value>>, missingCache}]} */
export async function readXlsx(bytes) {
  const z = await readZip(bytes);
  const get = (p) => (z[p] ? textOf(z[p]) : null);
  const shared = [];
  const ssx = get('xl/sharedStrings.xml');
  if (ssx) for (const m of ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])[1];
    const target = /Target="([^"]+)"/.exec(m[0])[1];
    relMap[id] = target.replace(/^\/?(xl\/)?/, 'xl/');
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    const xml = get(relMap[rid]);
    if (!xml) continue;
    const rows = new Map();
    let missingCache = 0;
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]; const inner = c[2] || '';
      const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
      if (!ref) continue;
      const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let value = null;
      if (type === 's' && v) value = shared[Number(v[1])];
      else if (type === 'inlineStr') value = texts(inner);
      else if (v) value = decode(v[1]);
      else if (/<f\b/.test(inner)) missingCache++;
      if (value === null || value === '') continue;
      const row = Number(ref[2]);
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row).set(ref[1], value);
    }
    sheets.push({ name, rows, missingCache });
  }
  return { sheets };
}
