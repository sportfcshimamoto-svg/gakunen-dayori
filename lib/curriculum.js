// 教科の年間カリキュラム（Word）の表を読み、教科ごと・月ごとの項目を「原文のまま」取り出す。
// 表の形：横が月（４月〜３月）、縦が教科。2ページにわたる表（1つの続いた表でも、ページごとに分かれた表でも）に対応する。
// 文字は変えない（行の前後の空白と、空の行だけ取り除く）。内容を推測して足すことはしない。
// ブラウザでもNode.jsでも動く。
import { readZip, textOf } from './zip.js';

const MONTH = /^[\s　]*([0-9０-９]{1,2})[\s　]*月/;
const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
export const SCHOOL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}
const attr = (a, name) => { const r = new RegExp(`${name}="([^"]*)"`).exec(a); return r ? r[1] : null; };

/**
 * Wordの本文の中の表を、すべて取り出す。
 * @returns [ table ]  table = [ row ]  row = { gridBefore, cells: [{ lines: [文字], span, vMerge: 'restart'|'continue'|null }] }
 */
export function tablesOfDocumentXml(xml) {
  const re = /<(\/?)(w:tbl|w:tr|w:tc|w:p|w:t|w:tab|w:br|w:cr|w:gridSpan|w:gridBefore|w:vMerge|w:rt)\b([^>]*?)(\/?)>/g;
  const tables = []; const stack = [];   // 表の入れ子に対応
  let row = null; let cell = null; let para = null; let inRt = 0;
  const cur = () => stack[stack.length - 1];
  let m;
  while ((m = re.exec(xml))) {
    const [, close, tag, a, self] = m;
    const t = stack.length ? cur() : null;
    if (tag === 'w:tbl') {
      if (close) { const done = stack.pop(); tables.push(done.rows); const p = cur(); row = p ? p.row : null; cell = p ? p.cell : null; }
      else { if (t) { t.row = row; t.cell = cell; } stack.push({ rows: [] }); row = null; cell = null; }
    } else if (!t) {
      continue;   // 表の外の文字は使わない
    } else if (tag === 'w:tr') {
      if (close) row = null; else { row = { gridBefore: 0, cells: [] }; t.rows.push(row); }
    } else if (tag === 'w:gridBefore' && row && !cell) {
      row.gridBefore = Number(attr(a, 'w:val')) || 0;
    } else if (tag === 'w:tc') {
      if (close) cell = null; else if (row) { cell = { lines: [], span: 1, vMerge: null }; row.cells.push(cell); }
    } else if (tag === 'w:gridSpan' && cell) {
      cell.span = Number(attr(a, 'w:val')) || 1;
    } else if (tag === 'w:vMerge' && cell) {
      cell.vMerge = attr(a, 'w:val') === 'restart' ? 'restart' : 'continue';
    } else if (tag === 'w:p') {
      if (close || self) { if (para !== null && cell) cell.lines.push(...para.split('\n')); para = null; }
      else para = '';
    } else if (tag === 'w:rt') {
      if (self) continue;
      inRt += close ? -1 : 1;    // ふりがな（ルビ）は使わない
    } else if (tag === 'w:t' && !close && !self) {
      const end = xml.indexOf('</w:t>', re.lastIndex);
      if (end < 0) break;
      if (para !== null && !inRt) para += decode(xml.slice(re.lastIndex, end));
      re.lastIndex = end + 6;
    } else if ((tag === 'w:tab') && para !== null && !inRt && !close) {
      para += ' ';
    } else if ((tag === 'w:br' || tag === 'w:cr') && para !== null && !inRt && !close && !/w:type="page"/.test(a)) {
      para += '\n';
    }
  }
  return tables;
}

/** 行の各マスが、表の何列目から何列分かを付ける */
function withColumns(row) {
  let col = row.gridBefore || 0;
  return row.cells.map((c) => { const r = { ...c, col }; col += c.span; return r; });
}
const cleanLines = (lines) => lines.map((l) => l.replace(/[\s　]+$/, '').replace(/^[\s　]+/, '')).filter((l) => l !== '');
const labelOf = (lines) => lines.join('').replace(/[\s　]+/g, '');

/** 月の見出しの行なら、列 → 月 の対応を返す */
function monthHeader(cells) {
  const map = new Map(); const months = new Set();
  for (const c of cells) {
    const r = MONTH.exec(toHalf(c.lines.join('')));
    if (!r) continue;
    const mo = Number(r[1]); if (mo < 1 || mo > 12) continue;
    months.add(mo);
    for (let k = 0; k < c.span; k++) map.set(c.col + k, mo);
  }
  return months.size >= 3 ? map : null;
}

/**
 * カリキュラムのWordから、教科ごと・月ごとの項目を取り出す
 * @returns { subjects: [{ label, months: { 4: [行…], … } }], warnings: [文], tableCount }
 */
export async function extractCurriculum(docxBytes) {
  let files;
  try { files = await readZip(docxBytes); } catch { throw new Error('Wordファイル（.docx）として読み込めませんでした。'); }
  if (!files['word/document.xml']) throw new Error('Wordファイル（.docx）として読み込めませんでした。');
  return extractFromTables(tablesOfDocumentXml(textOf(files['word/document.xml'])));
}

export function extractFromTables(tables) {
  const subjects = []; const byLabel = new Map(); const warnings = [];
  const spanNotes = new Set();
  let colMonth = null; let used = 0;
  const subjectOf = (label) => {
    if (!byLabel.has(label)) { const s = { label, months: {} }; byLabel.set(label, s); subjects.push(s); }
    return byLabel.get(label);
  };
  // 見出しのない続きの表（2ページ目）は、前の表の月の並びをそのまま使う
  tables.forEach((rows) => {
    let carry = [];   // 教科の列ごとの、上のマスの名前（縦につながったマス用）
    let lastLabel = '';
    for (const raw of rows) {
      const cells = withColumns(raw);
      const h = monthHeader(cells);
      if (h) { colMonth = h; carry = []; continue; }   // 見出しの行（2ページ目のくり返しも）
      if (!colMonth) continue;                        // 見出しより上（表の題名など）
      const firstMonthCol = Math.min(...colMonth.keys());
      // 教科の名前（月より左の列）
      const parts = [];
      for (const c of cells.filter((x) => x.col < firstMonthCol)) {
        const name = labelOf(c.lines);
        const v = c.vMerge === 'continue' || (!name && carry[c.col]) ? carry[c.col] || '' : name;
        if (c.vMerge !== 'continue' && name) carry[c.col] = name;
        if (v) parts.push(v);
      }
      let label = [...new Set(parts)].join('・');
      if (!label) label = lastLabel;                 // 名前のマスが空なら、上の教科の続き
      const content = cells.filter((x) => x.col >= firstMonthCol && x.vMerge !== 'continue');
      const hasText = content.some((c) => cleanLines(c.lines).length);
      if (!label) { if (hasText) warnings.push(`教科の名前がない行がありました（${cleanLines(content.flatMap((c) => c.lines))[0]}…）。読み込んでいません。`); continue; }
      lastLabel = label;
      const sub = subjectOf(label); used++;
      for (const c of content) {
        const lines = cleanLines(c.lines); if (!lines.length) continue;
        const months = [...new Set(Array.from({ length: c.span }, (_, k) => colMonth.get(c.col + k)).filter(Boolean))];
        if (!months.length) { warnings.push(`「${label}」の、月が分からない列に文字がありました（${lines[0]}…）。読み込んでいません。`); continue; }
        if (months.length > 1) spanNotes.add(`「${label}」に、${months[0]}月〜${months[months.length - 1]}月にまたがるマスがあります（${lines[0]}…）。それぞれの月に入れています。`);
        for (const mo of months) (sub.months[mo] = sub.months[mo] || []).push(...lines);
      }
    }
  });
  if (!colMonth) warnings.unshift('月（４月、５月…）の見出しがある表が見つかりませんでした。横が月、縦が教科の表かどうか確かめてください。');
  else if (!used) warnings.unshift('教科の行が見つかりませんでした。');
  else {
    const found = new Set(subjects.flatMap((s) => Object.keys(s.months).map(Number)));
    const missing = SCHOOL_MONTHS.filter((mo) => !found.has(mo));
    if (missing.length && missing.length < 12) warnings.push(`${missing.map((x) => x + '月').join('・')}の項目が、どの教科にもありませんでした。`);
  }
  return { subjects, warnings: [...warnings, ...spanNotes], tableCount: tables.length };
}
