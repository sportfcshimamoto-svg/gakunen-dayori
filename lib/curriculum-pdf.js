// 教科の年間カリキュラム（PDF）の表を読む。
// 学校のパソコンでWordファイルを選べないときのため。WordやExcelから「PDFとして保存」した表を想定する。
// PDFの罫線（表の線）と文字の位置から、Wordの表と同じ形（行・マス・横につながったマス・縦につながったマス）を組み立て、
// あとは Word と同じ extractFromTables で、教科ごと・月ごとの項目を取り出す。
// PDFを読む部品（pdf.js、Mozilla製・無料）は app/lib/vendor/pdfjs に置いてあり、インターネットには何も送らない。
// 注意：PDFには「段落」の区切りが残らないので、マスの中で折り返された行は、行の長さから「続きの行」かを推し量ってつなぐ。
import { extractFromTables } from './curriculum.js';

const VENDOR = new URL('./vendor/pdfjs/', import.meta.url);
let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL('pdf.min.mjs', VENDOR).href).then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', VENDOR).href;
      return m;
    });
  }
  return pdfjsPromise;
}

export const isPdf = (bytes) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

const TOL = 1.5;          // 線の位置のずれを同じとみなす幅（pt）
const THIN = 3;           // これより細い塗りつぶしは「線」とみなす（pt）
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** ページの中の、縦と横の線（斜めの線は使わない）を取り出す。座標は画面の向き（左上が原点、下に行くほどyが大きい） */
async function segmentsOf(pdfjs, page, vt) {
  const { OPS } = pdfjs;
  const ops = await page.getOperatorList();
  const H = []; const V = [];   // H: {y, x1, x2}  V: {x, y1, y2}
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [];
  let rects = []; let lines = [];   // いま組み立て中の図形（ページの座標）
  const addSeg = (a, b) => {
    const dx = Math.abs(a[0] - b[0]); const dy = Math.abs(a[1] - b[1]);
    if (dy <= 0.5 && dx > 2) H.push({ y: (a[1] + b[1]) / 2, x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]) });
    else if (dx <= 0.5 && dy > 2) V.push({ x: (a[0] + b[0]) / 2, y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
  };
  const toView = (x, y) => apply(vt, ...apply(ctm, x, y));
  const paint = (stroke, fill) => {
    for (const r of rects) {
      const ps = [toView(r[0], r[1]), toView(r[0] + r[2], r[1]), toView(r[0] + r[2], r[1] + r[3]), toView(r[0], r[1] + r[3])];
      const xs = ps.map((p) => p[0]); const ys = ps.map((p) => p[1]);
      const x1 = Math.min(...xs); const x2 = Math.max(...xs); const y1 = Math.min(...ys); const y2 = Math.max(...ys);
      if (fill && !stroke) {
        // 細い塗りつぶしは線（Wordの表の罫線はこの形）。太いもの（マスの色）は使わない
        if (y2 - y1 <= THIN && x2 - x1 > 2) H.push({ y: (y1 + y2) / 2, x1, x2 });
        else if (x2 - x1 <= THIN && y2 - y1 > 2) V.push({ x: (x1 + x2) / 2, y1, y2 });
      } else if (stroke) {
        addSeg([x1, y1], [x2, y1]); addSeg([x2, y1], [x2, y2]); addSeg([x2, y2], [x1, y2]); addSeg([x1, y2], [x1, y1]);
      }
    }
    if (stroke) for (const [a, b] of lines) addSeg(toView(...a), toView(...b));
    rects = []; lines = [];
  };
  let cur = null; let start = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]; const args = ops.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push(ctm); break;
      case OPS.restore: ctm = stack.pop() || [1, 0, 0, 1, 0, 0]; break;
      case OPS.transform: ctm = mul(ctm, args); break;
      case OPS.constructPath: {
        const [pops, pargs] = args; let j = 0;
        for (const op of pops) {
          if (op === OPS.rectangle) { rects.push(pargs.slice(j, j + 4)); j += 4; cur = null; }
          else if (op === OPS.moveTo) { cur = start = [pargs[j], pargs[j + 1]]; j += 2; }
          else if (op === OPS.lineTo) { const p = [pargs[j], pargs[j + 1]]; if (cur) lines.push([cur, p]); cur = p; j += 2; }
          else if (op === OPS.curveTo) { cur = [pargs[j + 4], pargs[j + 5]]; j += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = [pargs[j + 2], pargs[j + 3]]; j += 4; }
          else if (op === OPS.closePath) { if (cur && start) lines.push([cur, start]); cur = start; }
        }
        break;
      }
      case OPS.stroke: case OPS.closeStroke: paint(true, false); break;
      case OPS.fill: case OPS.eoFill: paint(false, true); break;
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: paint(true, true); break;
      case OPS.endPath: rects = []; lines = []; break;
      default: break;
    }
  }
  return { H, V };
}

/** 近い値をまとめる */
function cluster(values) {
  const s = [...values].sort((a, b) => a - b); const out = [];
  for (const v of s) { const last = out[out.length - 1]; if (last && v - last.max <= TOL) { last.max = v; last.sum += v; last.n++; } else out.push({ max: v, sum: v, n: 1 }); }
  return out.map((c) => c.sum / c.n);
}
const nearest = (list, v) => { let bi = -1; let bd = TOL + 0.01; list.forEach((x, i) => { const d = Math.abs(x - v); if (d < bd) { bd = d; bi = i; } }); return bi; };

// 段落の中に入る（段落そのものではない）しるし。これ以外のしるし（P、H1など）を段落とみなす
const INLINE_ROLES = new Set(['Span', 'Link', 'Quote', 'Note', 'Reference', 'BibEntry', 'Code', 'Annot', 'Ruby', 'RB', 'RP', 'Warichu', 'WT', 'WP', 'Em', 'Strong', 'Sub']);

/**
 * タグ付きPDF（WordやExcelから保存したもの）なら、文字のまとまり（id）→ 段落 の対応を返す。
 * ふりがな（RT）の文字は skip に入れる。
 */
async function paragraphsOf(page) {
  const para = new Map(); const skip = new Set();
  let tree = null;
  try { tree = await page.getStructTree(); } catch { return { para, skip }; }
  if (!tree) return { para, skip };
  let n = 0;
  const walk = (node, key, rt) => {
    if (!node) return;
    if (node.type === 'content') { if (rt) skip.add(node.id); else if (key != null) para.set(node.id, key); return; }
    const role = node.role || '';
    const isRt = rt || role === 'RT';
    const k = role && !INLINE_ROLES.has(role) && role !== 'RT' ? ++n : key;
    for (const c of node.children || []) walk(c, k, isRt);
  };
  walk(tree, null, false);
  return { para, skip };
}

/** ページの文字を取り出す（横書きの文字だけ）。{ str, x1, x2, y(文字の中ほど), base, fs, para(段落の番号。分からなければ null) } */
async function textItemsOf(pdfjs, page, vt) {
  const tc = await page.getTextContent({ includeMarkedContent: true });
  const { para, skip } = await paragraphsOf(page);
  const items = []; const mc = [];
  for (const it of tc.items) {
    if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') { mc.push(it.id || null); continue; }
    if (it.type === 'endMarkedContent') { mc.pop(); continue; }
    if (!it.str) continue;
    const ids = mc.filter(Boolean);
    if (ids.some((id) => skip.has(id))) continue;   // ふりがな
    const pid = [...ids].reverse().find((id) => para.has(id));
    const m = pdfjs.Util.transform(vt, it.transform);
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue;   // 縦書き・回転した文字は使わない
    const fs = Math.abs(m[3]) || Math.abs(m[0]) || 10;
    const x1 = m[4]; const base = m[5];
    items.push({ str: it.str, x1, x2: x1 + Math.abs(it.width), base, y: base - fs * 0.35, fs, para: pid ? para.get(pid) : null });
  }
  return items;
}

const ASCII_END = /[A-Za-z0-9.,!?'’)\]:;-]$/;
const ASCII_START = /^[A-Za-z0-9(['‘"“]/;
// 空白は、英語の単語のあいだだけ残す（日本語の文字のあいだの空きは、PDFで字の間隔を広げたもので、原文の空白とは限らない）
const tidy = (s) => s.replace(/[\s　]+/g, ' ').replace(/([^\x00-\x7f]) /g, '$1').replace(/ ([^\x00-\x7f])/g, '$1').trim();
const joinText = (a, b) => (a && b && ASCII_END.test(a) && ASCII_START.test(b) ? `${a} ${b}` : a + b);

/** 文字を見た目の行にまとめる（上から順） */
function visualLines(items) {
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x1 - b.x1);
  const rows = [];
  for (const it of sorted) {
    const r = rows.find((x) => Math.abs(x.base - it.base) <= Math.min(x.fs, it.fs) * 0.5);
    if (r) { r.items.push(it); r.fs = Math.max(r.fs, it.fs); } else rows.push({ base: it.base, fs: it.fs, items: [it] });
  }
  rows.sort((a, b) => a.base - b.base);
  return rows.map((r) => {
    r.items.sort((a, b) => a.x1 - b.x1);
    let s = ''; let prev = null; let gapSpace = false;
    for (const it of r.items) {
      if (!it.str.trim()) { gapSpace = true; continue; }
      if (prev && (gapSpace || it.x1 - prev.x2 > r.fs * 0.25)) s += ' ';
      s += it.str; prev = it; gapSpace = false;
    }
    const real = r.items.filter((x) => x.str.trim());
    return { text: tidy(s), x1: Math.min(...real.map((x) => x.x1)), x2: Math.max(...real.map((x) => x.x2)), fs: r.fs };
  }).filter((l) => l.text);
}

/** 1つのマスの文字を、Wordの「段落」ごとの行にする */
function linesOfCell(items) {
  items = items.filter((x) => x.str.trim());
  if (!items.length) return [];
  // ふりがな（本文の文字の6割より小さい字）は使わない
  const big = Math.max(...items.map((x) => x.fs));
  items = items.filter((x) => x.fs >= big * 0.6);
  // タグ付きPDF：段落がはっきり分かるので、段落ごとにまとめる
  if (items.every((x) => x.para != null)) {
    const groups = new Map();
    for (const it of items) { if (!groups.has(it.para)) groups.set(it.para, []); groups.get(it.para).push(it); }
    return [...groups.values()]
      .map((g) => ({ top: Math.min(...g.map((x) => x.base)), left: Math.min(...g.map((x) => x.x1)), text: visualLines(g).map((l) => l.text).reduce(joinText, '') }))
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .map((p) => p.text).filter(Boolean);
  }
  // タグのないPDF：右の端まで文字がある行は、次の行に続いているとみなす
  const vis = visualLines(items);
  if (!vis.length) return [];
  const right = Math.max(...vis.map((l) => l.x2));
  const out = []; let joinNext = false;
  for (const l of vis) {
    if (joinNext && out.length) out[out.length - 1] = joinText(out[out.length - 1], l.text);
    else out.push(l.text);
    joinNext = vis.length > 1 && l.x2 >= right - l.fs * 0.8;
  }
  return out;
}

/**
 * 1ページ分の表を、Wordの表と同じ形にする
 * @param xs 表の縦の線の位置（全ページ共通。ページが変わっても列の番号がそろうように）
 */
function tableOfPage(xs, H, V, items) {
  const nC = xs.length - 1; if (nC < 1) return [];
  const xMin = xs[0]; const xMax = xs[nC];
  // 横の線のうち、どこかの列の端から端までを通っているものだけを、行の区切りにする（下線や取り消し線は使わない）
  const covers = (s, a, b) => s.x1 <= a + TOL * 2 && s.x2 >= b - TOL * 2;
  const hb = H.filter((s) => s.x2 > xMin && s.x1 < xMax && xs.some((x, c) => c < nC && covers(s, x, xs[c + 1])));
  const ys = cluster(hb.map((s) => s.y));
  const nR = ys.length - 1; if (nR < 1) return [];
  // 線があるか
  const lineH = (r, c) => hb.some((s) => Math.abs(s.y - ys[r]) <= TOL && covers(s, xs[c], xs[c + 1]));
  const hasV = (r, c) => V.some((s) => Math.abs(s.x - xs[c]) <= TOL && s.y1 <= ys[r] + TOL * 2 && s.y2 >= ys[r + 1] - TOL * 2);
  // 行の区切りの線が、1マス分だけ抜けていることがある（WordのPDFで実際にあった）。
  // その行の線が大部分の列にあり、抜けたところの上と下の両方に文字があれば、区切りがあるとみなす
  const idxOf = (list, v) => { for (let i = 0; i < list.length - 1; i++) if (v >= list[i] && v < list[i + 1]) return i; return -1; };
  const textIn = Array.from({ length: nR }, () => new Array(nC).fill(false));
  for (const it of items) {
    if (!it.str.trim()) continue;
    const c = idxOf(xs, (it.x1 + it.x2) / 2); const r = idxOf(ys, it.y);
    if (c >= 0 && r >= 0) textIn[r][c] = true;
  }
  const share = ys.map((_, r) => { let k = 0; for (let c = 0; c < nC; c++) if (lineH(r, c)) k++; return k / nC; });
  const hasH = (r, c) => lineH(r, c) || (share[r] >= 2 / 3 && r > 0 && r < nR && textIn[r - 1][c] && textIn[r][c]);
  // 線のないところでつながったマスをまとめる
  const id = Array.from({ length: nR }, (_, r) => Array.from({ length: nC }, (_, c) => r * nC + c));
  const parent = id.flat();
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
    if (c + 1 < nC && !hasV(r, c + 1)) unite(id[r][c], id[r][c + 1]);
    if (r + 1 < nR && !hasH(r + 1, c)) unite(id[r][c], id[r + 1][c]);
  }
  const regions = new Map();
  for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
    const k = find(id[r][c]);
    const g = regions.get(k) || { r1: r, r2: r, c1: c, c2: c, items: [] };
    g.r1 = Math.min(g.r1, r); g.r2 = Math.max(g.r2, r); g.c1 = Math.min(g.c1, c); g.c2 = Math.max(g.c2, c);
    regions.set(k, g);
  }
  // 左右に線がない場所（表の外）は使わない
  for (const [k, g] of regions) {
    let left = false; let rightB = false;
    for (let r = g.r1; r <= g.r2; r++) { if (hasV(r, g.c1)) left = true; if (hasV(r, g.c2 + 1)) rightB = true; }
    if (!left || !rightB) regions.delete(k);
  }
  // 文字をマスに入れる
  for (const it of items) {
    const c = idxOf(xs, (it.x1 + it.x2) / 2); const r = idxOf(ys, it.y);
    if (c < 0 || r < 0) continue;
    const g = regions.get(find(id[r][c])); if (g) g.items.push(it);
  }
  for (const g of regions.values()) {
    g.lines = linesOfCell(g.items);
    // 最後の行が右の端まであるか（次のページに続いているかもしれない）
    const real = g.items.filter((x) => x.str.trim());
    if (real.length) {
      const lastBase = Math.max(...real.map((x) => x.base));
      const last = real.filter((x) => Math.abs(x.base - lastBase) <= x.fs * 0.5);
      g.cont = Math.max(...last.map((x) => x.x2)) >= xs[g.c2 + 1] - Math.max(...last.map((x) => x.fs)) * 2.2;
    }
  }
  // Wordの表と同じ形にする
  const rows = [];
  for (let r = 0; r < nR; r++) {
    const row = { gridBefore: 0, cells: [] }; let first = true;
    for (let c = 0; c < nC; c++) {
      const g = regions.get(find(id[r][c]));
      if (!g) { if (first) row.gridBefore++; continue; }
      if (g.c1 !== c) continue;
      first = false;
      const multi = g.r2 > g.r1;
      row.cells.push({ lines: g.r1 === r ? g.lines : [], span: g.c2 - g.c1 + 1, vMerge: multi ? (g.r1 === r ? 'restart' : 'continue') : null, cont: !!g.cont });
    }
    if (row.cells.length) rows.push(row);
  }
  return rows;
}

const colsOf = (row) => { let col = row.gridBefore || 0; return row.cells.map((c) => { const r = { cell: c, col }; col += c.span; return r; }); };
const hasText = (row) => row.cells.some((c) => c.lines.length);
const isMonthHeader = (row) => row.cells.filter((c) => /^[\s　]*[0-9０-９]{1,2}[\s　]*月/.test(c.lines.join(''))).length >= 3;

/**
 * ページの境目で切れた行をつなぐ。
 * 次のページの最初の行で、いちばん左のマス（教科の名前）が空なら、前のページの最後の行の続きとみなし、
 * 同じ列のマスに文字を足す（前のマスの最後の行が右の端まであれば、同じ項目の続きとしてつなぐ）
 */
function joinSplitRows(tables) {
  for (let p = 1; p < tables.length; p++) {
    const rows = tables[p]; const prevRows = tables[p - 1];
    const i = rows.findIndex((r) => hasText(r) && !isMonthHeader(r));   // くり返しの見出し（４月、５月…）の行は飛ばす
    if (i < 0 || !prevRows.length) continue;
    const first = colsOf(rows[i]);
    if (!first.length || first[0].cell.lines.length || first[0].col !== 0) continue;   // 教科の名前がある＝新しい行
    const prev = colsOf(prevRows[prevRows.length - 1]);
    if (!prev.length) continue;
    for (const { cell, col } of first) {
      if (!cell.lines.length) continue;
      const k = prev.findIndex((x) => x.col === col && x.cell.span === cell.span);
      if (k < 0) return;   // 列がそろわないときは、つながない
    }
    for (const { cell, col } of first) {
      if (!cell.lines.length) continue;
      let target = prev.find((x) => x.col === col).cell;
      if (target.vMerge === 'continue') {   // 縦につながったマスなら、文字のある上のマスに足す
        for (let r = prevRows.length - 2; r >= 0; r--) {
          const t = colsOf(prevRows[r]).find((x) => x.col === col);
          if (t && t.cell.vMerge !== 'continue') { target = t.cell; break; }
        }
      }
      const lines = [...cell.lines];
      if (target.cont && target.lines.length) target.lines[target.lines.length - 1] = joinText(target.lines[target.lines.length - 1], lines.shift());
      target.lines.push(...lines);
      target.cont = cell.cont;
    }
    rows.splice(i, 1);
  }
}

/** PDFの表を、ページごとの表（Wordの表と同じ形）にして返す */
export async function tablesOfPdf(bytes) {
  const pdfjs = await loadPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes, isEvalSupported: false, verbosity: 0,
      cMapUrl: new URL('cmaps/', VENDOR).href, cMapPacked: true,
    }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('パスワードのかかったPDFは読み込めません。パスワードなしで保存し直してください。');
    throw new Error('PDFファイルとして読み込めませんでした。');
  }
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vt = page.getViewport({ scale: 1 }).transform;
      const { H, V } = await segmentsOf(pdfjs, page, vt);
      const items = await textItemsOf(pdfjs, page, vt);
      pages.push({ H, V, items });
    }
  } finally { doc.destroy(); }
  const textCount = pages.reduce((n, p) => n + p.items.filter((x) => x.str.trim()).length, 0);
  // 縦の線の位置は全ページ共通にする（2ページ目に見出しがなくても、同じ列が同じ月になる）
  const xs = cluster(pages.flatMap((p) => p.V.filter((s) => s.y2 - s.y1 > 4).map((s) => s.x)));
  const tables = pages.map((p) => tableOfPage(xs, p.H, p.V, p.items));
  joinSplitRows(tables);
  const tagged = pages.some((p) => p.items.some((x) => x.str.trim())) && pages.every((p) => p.items.every((x) => !x.str.trim() || x.para != null));
  return { tables, textCount, tagged };
}

/** カリキュラムのPDFから、教科ごと・月ごとの項目を取り出す（返す形は extractCurriculum と同じ） */
export async function extractCurriculumPdf(bytes) {
  const { tables, textCount, tagged } = await tablesOfPdf(bytes);
  if (!textCount) throw new Error('このPDFからは文字を読み取れませんでした（紙をスキャンしたPDFなど、文字が画像になっているものは読めません）。WordやExcelから「PDFとして保存」したものを使ってください。');
  if (!tables.some((t) => t.length)) throw new Error('PDFの中に、罫線で囲まれた表が見つかりませんでした。横が月、縦が教科の表かどうか確かめてください。');
  const r = extractFromTables(tables);
  if (r.subjects.length) {
    r.warnings.unshift(tagged
      ? 'PDFから読み込みました。日本語の文字と文字のあいだの空白は入れていません（PDFでは、字の間隔の空きと区別できないため）。'
      : 'PDFから読み込みました。このPDFには段落の区切りが残っていないため、マスの中で折り返された行のつなぎ方が、元の表とちがうことがあります。月ごとの項目を確かめてください。（Wordで「PDFとして保存」するときに、「オプション」の「ドキュメント構造タグ」に印を付けると、正しく読み取れます）');
  }
  return r;
}
