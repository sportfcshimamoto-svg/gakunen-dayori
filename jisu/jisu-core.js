// 授業時数表アプリの中身（画面のない部分）。
// 週案（Googleスプレッドシートを Excel の形で読み込んだもの）から教科を読み取り、
// 授業時数表（Excel）の「マスの文字」だけを書きかえる。色・書式・プルダウン・数式はそのまま残す。
// ブラウザとNode.jsの両方で動く（Node.jsでは動作確認に使う）。
import { readZip, writeZip, textOf } from '../lib/zip.js';

// ---------- 小さな道具 ----------
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const texts = (xml) => decode((xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [])
  .map((t) => t.replace(/^<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, '')).join(''));

export function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const DAYS = ['月', '火', '水', '木', '金'];
export const SLOTS = ['朝', '1', '2', '3', '4', '5', '6'];   // 朝 = 朝学（時数表の「モジュール」）

/** Excel を読み、シートごとに { name, path, cells: Map<"A1", 値>, xml } を返す */
export async function openBook(bytes) {
  const files = await readZip(bytes);
  const get = (p) => (files[p] ? textOf(files[p]) : null);
  const shared = [];
  const ssx = get('xl/sharedStrings.xml');
  if (ssx) for (const m of ssx.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const relMap = {};
  for (const m of (get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])[1];
    const target = /Target="([^"]+)"/.exec(m[0])[1];
    relMap[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheets = [];
  for (const m of (get('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]);
    const path = relMap[/r:id="([^"]+)"/.exec(m[0])[1]];
    const xml = get(path);
    if (!xml) continue;
    const cells = new Map();
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1]);
      if (!ref) continue;
      const type = (/\bt="(\w+)"/.exec(c[1]) || [])[1];
      const inner = c[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let value = null;
      if (type === 's' && v) value = shared[Number(v[1])];
      else if (type === 'inlineStr') value = texts(inner);
      else if (v) value = decode(v[1]);
      if (value !== null && value !== '') cells.set(ref[1], value);
    }
    sheets.push({ name, path, cells, xml });
  }
  return { files, sheets };
}
const at = (sheet, col, row) => sheet.cells.get(colName(col) + row);
function bounds(sheet) {
  let maxR = 0, maxC = 0;
  for (const ref of sheet.cells.keys()) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    maxR = Math.max(maxR, Number(m[2])); maxC = Math.max(maxC, colNum(m[1]));
  }
  return { maxR, maxC };
}

// ---------- 授業時数表（Excel） ----------
/**
 * 授業時数表のシートの形を調べる。シートの名前には頼らない（名前が変わっても見つけられる）。
 * 見つけるもの：「モジュール」と 1〜6 の見出し（月〜金）、小さなカレンダー（日〜土）、「第○週」の行。
 */
export function readJisuSheet(sheet, schoolYear) {
  const { maxR, maxC } = bounds(sheet);
  // 見出しの行：「モジュ」で始まるマスが5つある行
  let headRow = 0, mods = [];
  for (let r = 1; r <= Math.min(maxR, 20) && !headRow; r++) {
    const cs = [];
    for (let c = 1; c <= maxC; c++) if (norm(at(sheet, c, r)).startsWith('モジュ')) cs.push(c);
    if (cs.length === 5) { headRow = r; mods = cs; }
  }
  if (!headRow) return { ok: false, reason: '「モジュール」と1〜6の見出しが見つかりません' };
  const days = [];
  for (const mc of mods) {
    const periods = [];
    for (let k = 1; k <= 6; k++) {
      if (norm(at(sheet, mc + k, headRow)) !== String(k)) return { ok: false, reason: '1〜6校時の見出しがそろっていません' };
      periods.push(colName(mc + k));
    }
    days.push({ module: colName(mc), periods });
  }
  // 小さなカレンダー：「日」の右に「月」…「土」が並ぶ行
  let calRow = 0, sunCol = 0;
  for (let r = 1; r <= headRow && !calRow; r++) {
    for (let c = 1; c <= maxC - 6; c++) {
      if (norm(at(sheet, c, r)) === '日' && norm(at(sheet, c + 1, r)) === '月' && norm(at(sheet, c + 6, r)) === '土') { calRow = r; sunCol = c; break; }
    }
  }
  if (!calRow) return { ok: false, reason: '日〜土のカレンダーが見つかりません' };
  // 年度：「令和」の右の数字。なければ受け取った年度
  let year = schoolYear;
  for (let r = 1; r <= 3; r++) for (let c = 1; c <= maxC; c++) {
    if (norm(at(sheet, c, r)) === '令和') {
      for (let k = 1; k <= 4; k++) { const n = Number(norm(at(sheet, c + k, r))); if (n > 0 && n < 100) { year = 2018 + n; break; } }
    }
  }
  if (!year) return { ok: false, reason: '年度が分かりません' };
  // 週の行：カレンダーの日付から、その週の月曜日の日付を出す（月が変わるのは日付が小さくなったとき）
  const weeks = new Map();
  let month = 4, y = year, prevLast = 0;
  for (let r = calRow + 1; r <= maxR; r++) {
    let lastCol = 0, lastDay = 0;
    for (let k = 6; k >= 0; k--) { const n = Number(norm(at(sheet, sunCol + k, r))); if (n >= 1 && n <= 31) { lastCol = k; lastDay = n; break; } }
    if (!lastDay) continue;
    if (lastDay < prevLast) { month++; if (month > 12) { month = 1; y++; } }
    prevLast = lastDay;
    const label = [...Array(maxC).keys()].map((i) => norm(at(sheet, i + 1, r))).find((v) => /^第.+週$/.test(v));
    if (!label) continue;
    const mon = new Date(Date.UTC(y, month - 1, lastDay - (lastCol - 1)));
    weeks.set(iso(mon), { row: r, label });
  }
  if (!weeks.size) return { ok: false, reason: '「第○週」の行が見つかりません' };
  // プルダウンの中身（入れてよい文字）
  const options = readDropdown(sheet, days[0].periods[0] + [...weeks.values()][0].row);
  return { ok: true, year, days, weeks, options };
}

const DEFAULT_OPTIONS = ['国', '社', '算', '理', '生', '音', '図', '体', '家', '道', '特', '総', '外', '児', 'ク', '行'];
function inRange(ref, sqref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref); const c = colNum(m[1]), r = Number(m[2]);
  return sqref.split(/\s+/).some((part) => {
    const p = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(part);
    if (!p) return false;
    const c1 = colNum(p[1]), r1 = Number(p[2]), c2 = p[3] ? colNum(p[3]) : c1, r2 = p[4] ? Number(p[4]) : r1;
    return c >= c1 && c <= c2 && r >= r1 && r <= r2;
  });
}
function readDropdown(sheet, ref) {
  for (const m of sheet.xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)) {
    const sq = /sqref="([^"]+)"/.exec(m[1]);
    if (!sq || !inRange(ref, sq[1])) continue;
    const f = /<formula1>([\s\S]*?)<\/formula1>/.exec(m[2]);
    if (!f) continue;
    const formula = decode(f[1]);
    const list = /^"(.*)"$/.exec(formula);
    if (list) return list[1].split(',').map(norm).filter(Boolean);
    const rg = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(formula);   // 同じシートの範囲だけ読む
    if (rg) {
      const out = [];
      for (let r = Number(rg[2]); r <= Number(rg[4]); r++) for (let c = colNum(rg[1]); c <= colNum(rg[3]); c++) {
        const v = norm(at(sheet, c, r)); if (v && !out.includes(v)) out.push(v);
      }
      if (out.length) return out;
    }
  }
  return DEFAULT_OPTIONS;
}

/** 時数表のその週の行に、いま入っている文字 { 月: {朝,1..6}, … } */
export function currentWeek(sheet, info, row) {
  const out = {};
  info.days.forEach((d, i) => {
    out[DAYS[i]] = { 朝: norm(sheet.cells.get(d.module + row)) };
    d.periods.forEach((p, k) => { out[DAYS[i]][String(k + 1)] = norm(sheet.cells.get(p + row)); });
  });
  return out;
}

// ---------- 週案（Googleスプレッドシート） ----------
/**
 * タブの名前（例 "914" "1013" "112"）と、見出しの月曜の日から、月曜日の日付の候補を出す。
 * 月曜が祝日の週は、タブの名前が火曜の日付のこともある（例 "1013" で月曜は12日）ので、
 * 名前の日付がその週の月〜金に入っていればよいことにする。
 */
function mondayCandidates(name, mondayDay, schoolYear) {
  let digits = norm(name);
  const slash = /^(\d{1,2})(?:\/|月)(\d{1,2})日?$/.exec(digits);   // 「12/14」「12月14日」の形
  if (slash) digits = slash[1] + slash[2].padStart(2, '0');
  if (!/^\d{2,4}$/.test(digits) || !mondayDay) return [];
  const out = [];
  for (const k of slash ? [slash[1].length] : [1, 2]) {
    const m = Number(digits.slice(0, k)), d = Number(digits.slice(k));
    if (digits.length - k < 1 || digits.length - k > 2 || m < 1 || m > 12 || d < 1 || d > 31) continue;
    const year = m >= 4 ? schoolYear : schoolYear + 1;
    const named = new Date(Date.UTC(year, m - 1, d));
    if (named.getUTCMonth() !== m - 1) continue;
    for (let back = 0; back <= 4; back++) {
      const mon = new Date(named.getTime() - back * 86400000);
      if (mon.getUTCDay() === 1 && mon.getUTCDate() === mondayDay) out.push(iso(mon));
    }
  }
  return [...new Set(out)];
}

/** 週案のタブを読む。週ごとに { name, monday, ab, classes: { '1組': { 月: {朝,1..6: 元の文字}, … } } } */
export function readShuan(book, schoolYear) {
  const found = [], skipped = [];
  for (const sh of book.sheets) {
    const { maxR, maxC } = bounds(sh);
    // 「1組」「2組」の見出し
    const classes = {};
    let mondayDay = 0, ab = null;
    for (let r = 1; r <= Math.min(maxR, 4); r++) for (let c = 1; c <= maxC; c++) {
      const v = norm(at(sh, c, r));
      const cm = /^(\d+)組$/.exec(v);
      if (cm) {
        const dayCols = {};
        for (let k = 1; k <= 7; k++) { const dv = norm(at(sh, c + k, r)); if (DAYS.includes(dv)) dayCols[dv] = c + k; }
        if (Object.keys(dayCols).length === 5) classes[v] = { labelCol: c, headRow: r, dayCols };
      }
      if (/^[AB]週$/.test(v) && !ab) ab = v[0];
    }
    const names = Object.keys(classes);
    if (!names.length) { skipped.push({ name: sh.name, reason: '「○組」と月〜金の見出しがありません' }); continue; }
    // 月曜の日：見出しの上の行の「14日」など（1組が空でも2組に書いてあればそれを使う）
    for (const cl of Object.values(classes)) {
      for (let r = 1; r < cl.headRow && !mondayDay; r++) {
        const m = /^(\d{1,2})日?$/.exec(norm(at(sh, cl.dayCols['月'], r)));
        if (m) mondayDay = Number(m[1]);
      }
    }
    const cands = mondayCandidates(sh.name, mondayDay, schoolYear);
    if (!cands.length) {
      skipped.push({ name: sh.name, reason: /^(\d{2,4}|\d{1,2}(?:\/|月)\d{1,2}日?)$/.test(norm(sh.name)) ? 'タブの名前と、月曜の日付が合いません' : '日付のタブではありません（ひな形など）' });
      continue;
    }
    const out = {};
    for (const cname of names) {
      const cl = classes[cname];
      const rows = {};
      for (let r = cl.headRow + 1; r <= maxR; r++) {
        const lab = norm(at(sh, cl.labelCol, r));
        if (lab === '朝学' || lab === '朝学習' || lab === 'モジュール') rows['朝'] = r;
        else if (/^[1-6](\.0+)?$/.test(lab)) rows[String(parseInt(lab, 10))] = r;
      }
      const grid = {};
      for (const d of DAYS) {
        grid[d] = {};
        for (const s of SLOTS) grid[d][s] = rows[s] ? norm(at(sh, cl.dayCols[d], rows[s])) : '';
      }
      out[cname] = grid;
    }
    found.push({ name: sh.name, cands, ab, classes: out });
  }
  // 「105」（1月5日？10月5日？）のように決めきれないタブは、前後のタブの日付から決める（タブは日付の順に並んでいる前提）
  found.forEach((w, i) => {
    if (w.cands.length === 1) { w.monday = w.cands[0]; return; }
    const prev = found.slice(0, i).reverse().find((x) => x.monday)?.monday || '';
    const next = found.slice(i + 1).find((x) => x.cands.length === 1)?.cands[0] || '9999';
    const fit = w.cands.filter((c) => c > prev && c < next);
    w.monday = fit.length === 1 ? fit[0] : null;
  });
  const weeks = [];
  for (const w of found) {
    if (!w.monday) { skipped.push({ name: w.name, reason: '日付を1つに決められません' }); continue; }
    const { cands, ...rest } = w;
    weeks.push(rest);
  }
  weeks.sort((a, b) => a.monday.localeCompare(b.monday));
  return { weeks, skipped };
}

// ---------- 教科の名前 → 時数表の1文字 ----------
export const RULES = [
  ['国語', '国'], ['書写', '国'], ['図書', '国'], ['読書', '国'], ['社会', '社'], ['算数', '算'], ['理科', '理'], ['生活', '生'],
  ['音楽', '音'], ['図画工作', '図'], ['図工', '図'], ['体育', '体'], ['保健', '体'], ['家庭', '家'], ['道徳', '道'],
  ['特活', '特'], ['学活', '特'], ['学級活動', '特'], ['総合', '総'], ['外国語', '外'], ['英語', '外'],
  ['漢字', '国'], ['漢スキ', '国'], ['漢テス', '国'], ['漢ノート', '国'], ['委員会', '児'], ['児童会', '児'], ['クラブ', 'ク'], ['学校行事', '行'], ['行事', '行'],
];

/**
 * 週案の1マスを、時数表の1文字にする。
 * - 「特活→外国語」のような「→」は、変更後（右側）を使う
 * - 「総/体」のような「/」は A週なら左、B週なら右（念のため「確認」の印を付ける）
 * - 「国語　漢テス40」のように後ろにメモがあれば、最初のことばだけを見る
 * @returns {{code: string, status: 'ok'|'empty'|'ab'|'unknown', word: string}}
 */
export function toCode(raw, ab, options, custom = {}) {
  let s = norm(raw);
  if (s.includes('→')) s = norm(s.split('→').pop());
  if (!s) return { code: '', status: 'empty', word: '' };
  let status = 'ok';
  if (/[/／]/.test(s)) {
    const parts = s.split(/[/／]/).map(norm);
    if (parts.length === 2 && (ab === 'A' || ab === 'B')) { s = ab === 'A' ? parts[0] : parts[1]; status = 'ab'; }
    else return { code: '', status: 'unknown', word: s };
  }
  const word = s.split(' ')[0];
  if (custom[word] !== undefined) return { code: custom[word], status: custom[word] ? status : 'empty', word };
  for (const [name, code] of RULES) if (word.startsWith(name) && options.includes(code)) return { code, status, word };
  const head = word[0];
  if (options.includes(head) && (word.length === 1 || word[1] === '(')) return { code: head, status, word };
  return { code: '', status: 'unknown', word };
}

// ---------- 書き込み ----------
/** シートのXMLの、決めたマスの文字だけを書きかえる（null は空にする）。マスの色や書式（s="…"）はそのまま */
export function setCells(xml, values) {
  const byRow = new Map();
  for (const [ref, v] of Object.entries(values)) {
    const r = Number(/\d+$/.exec(ref)[0]);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push([ref, v]);
  }
  const cellXml = (ref, style, v) => (v === null || v === ''
    ? `<c r="${ref}"${style}/>`
    : `<c r="${ref}"${style} t="inlineStr"><is><t>${encode(v)}</t></is></c>`);
  for (const [r, list] of byRow) {
    const rowRe = new RegExp(`<row\\b[^>]*\\br="${r}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
    const rm = rowRe.exec(xml);
    if (!rm) throw new Error(`${r}行目が見つかりません`);
    let rowXml = rm[0];
    if (rowXml.endsWith('/>')) rowXml = rowXml.slice(0, -2) + '></row>';
    for (const [ref, v] of list) {
      const cre = new RegExp(`<c\\b([^>]*?)\\br="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
      const cm = cre.exec(rowXml);
      if (cm) {
        const style = (/\s(s="\d+")/.exec(cm[1] + cm[2]) || ['', ''])[1];
        rowXml = rowXml.replace(cm[0], cellXml(ref, style ? ' ' + style : '', v));
      } else {
        // マスがない：列の順番どおりの場所に入れる
        const col = colNum(/^[A-Z]+/.exec(ref)[0]);
        let inserted = false;
        rowXml = rowXml.replace(/<c\b[^>]*\br="([A-Z]+)\d+"/g, (m0, letters) => {
          if (!inserted && colNum(letters) > col) { inserted = true; return cellXml(ref, '', v) + m0; }
          return m0;
        });
        if (!inserted) rowXml = rowXml.replace(/<\/row>$/, cellXml(ref, '', v) + '</row>');
      }
    }
    xml = xml.replace(rm[0], rowXml);
  }
  return xml;
}

/** 時数表の Excel に書き込んだ新しいファイル（Uint8Array）を作る。元のファイルは変えない */
export async function writeJisu(book, sheetName, values) {
  const sheet = book.sheets.find((s) => s.name === sheetName);
  const files = { ...book.files };
  files[sheet.path] = setCells(sheet.xml, values);
  // 開いたときにExcelが集計をすべて計算し直すようにする
  const wb = textOf(files['xl/workbook.xml']);
  files['xl/workbook.xml'] = /<calcPr\b[^>]*fullCalcOnLoad=/.test(wb) ? wb
    : /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"')
      : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  return writeZip(files, Object.keys(book.files));
}

/** 週案の1週分 → 時数表のマスごとの予定 [{ref, day, slot, raw, code, status, word, now}] */
export function planWeek(week, className, info, row, sheet, custom) {
  const grid = week.classes[className];
  const now = currentWeek(sheet, info, row);
  const out = [];
  info.days.forEach((d, i) => {
    const day = DAYS[i];
    SLOTS.forEach((slot, k) => {
      const ref = (k === 0 ? d.module : d.periods[k - 1]) + row;
      const raw = grid ? grid[day][slot] : '';
      const r = toCode(raw, week.ab, info.options, custom);
      out.push({ ref, day, slot, raw, ...r, now: now[day][slot] });
    });
  });
  return out;
}
