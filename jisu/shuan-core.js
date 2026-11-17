// 時間割 → 週案：画面のない部分。
// 時間割（コピペ、またはChatGPTで表にした画像）を読み取り、週案のひな形タブと同じ見た目の
// 「週のタブ」を何週分か作って、1つのExcelファイルにする。先生はそれを週案に「インポート → 新しいシートを挿入」で取り込む。
import { writeZip, textOf } from '../lib/zip.js';
import { setCells, colName, DAYS, SLOTS } from './jisu-core.js';

const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const dateOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (s, n) => isoOf(new Date(dateOf(s).getTime() + n * 86400000));
export const mondayOf = (s) => { const d = dateOf(s); return addDays(s, -((d.getUTCDay() + 6) % 7)); };

// ---------- 貼り付けた表を読む ----------
/** タブ区切りの文字（スプレッドシートのコピー）を2次元の表にする。「"…"」で囲まれた改行入りのマスにも対応 */
export function parseTsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * 時間割の表（2次元）から { 月: {朝,1..6}, … } を取り出す。
 * 「月 火 水 木 金」の見出しの行を探し、その下の「1」〜「6」の行を校時、1校時より前の行を朝学（じこく・読書など）とみる。
 */
export function parseTimetable(rows) {
  const t = rows.map((r) => r.map(norm));
  let h = -1, dayCols = null;
  for (let i = 0; i < t.length && h < 0; i++) {
    const cols = DAYS.map((d) => t[i].indexOf(d));
    if (cols.every((c) => c >= 0) && cols.every((c, k) => k === 0 || c > cols[k - 1])) { h = i; dayCols = cols; }
  }
  if (h < 0) return { ok: false, reason: '「月 火 水 木 金」の見出しが見つかりません。見出しの行もいっしょにコピーしてください' };
  const grid = Object.fromEntries(DAYS.map((d) => [d, Object.fromEntries(SLOTS.map((s) => [s, '']))]));
  const found = new Set();
  for (let i = h + 1; i < t.length; i++) {
    const r = t[i];
    const others = r.filter((_, c) => !dayCols.includes(c));
    const vals = dayCols.map((c) => r[c] || '');
    if (!vals.some(Boolean)) continue;
    const p = others.map((v) => /^([1-6])(校時|時間目)?$/.exec(v)).find(Boolean);
    let slot = null;
    if (p) slot = p[1];
    else if (!found.size && !found.has('朝')) slot = '朝';   // 1校時より前の行 = 朝学
    if (!slot || found.has(slot)) continue;
    found.add(slot);
    DAYS.forEach((d, k) => { grid[d][slot] = vals[k]; });
  }
  const missing = ['1', '2', '3', '4', '5', '6'].filter((s) => !found.has(s));
  if (missing.length === 6) return { ok: false, reason: '1〜6校時の行が見つかりません。左の「1」「2」…の列もいっしょにコピーしてください' };
  return { ok: true, grid, warnings: missing.length ? [`${missing.join('・')}校時の行が見つかりませんでした`] : [] };
}

/** ChatGPTに画像の時間割を表にしてもらうときのお願い文 */
export function imagePrompt() {
  return [
    'この画像は小学校の時間割表です。次の形の表にして、表だけを返してください。説明はいりません。',
    '・1行目は「（空）タブ 月 タブ 火 タブ 水 タブ 木 タブ 金」',
    '・2行目は「朝」：一番上の短い時間（じこく・朝学習・読書など）の教科',
    '・3〜8行目は「1」〜「6」：1〜6校時の教科',
    '・区切りはタブ。教科の書き方は画像のとおり（「総/体」「国(書写)」なども、そのまま）。空のマスは空にする',
    '・休み時間・給食・持ち物などの行は入れない',
    '',
    '例：',
    '\t月\t火\t水\t木\t金',
    '朝\t読書\t国語\t国語\t算数\t国語',
    '1\t総合\t算数\t外国語\t総/体\t特活',
  ].join('\n');
}

// ---------- 時間割の文字 → 週案の文字 ----------
const SHORT = { 国: '国語', 社: '社会', 算: '算数', 理: '理科', 生: '生活', 音: '音楽', 図: '図工', 体: '体育', 家: '家庭', 道: '道徳', 特: '特活', 総: '総合', 外: '外国語' };
/** 「総/体」は A週なら「総合」、B週なら「体育」。「国(書写)」は「国語（書写）」 */
export function toShuanWord(raw, ab) {
  let s = norm(raw);
  if (/[/／]/.test(s)) { const p = s.split(/[/／]/).map(norm); if (p.length === 2) s = ab === 'B' ? p[1] : p[0]; }
  if (SHORT[s]) return SHORT[s];
  const m = /^(.)\((.+)\)$/.exec(s);
  if (m && SHORT[m[1]]) return `${SHORT[m[1]]}（${m[2]}）`;
  return s;
}

// ---------- 週の予定 ----------
/**
 * 作る週の一覧。from〜to のあいだの月曜日ごとに1週。
 * A週/B週は、週案にある一番近い前の週の反対から始めて、交互にする（abOverride で1週ずつ変えられる）。
 */
export function planWeeks({ from, to, existing, abOverride = {} }) {
  const out = [];
  if (!from || !to || from > to) return out;
  const before = existing.filter((w) => w.monday < mondayOf(from)).sort((a, b) => a.monday.localeCompare(b.monday)).pop();
  let ab = before?.ab ? (before.ab === 'A' ? 'B' : 'A') : 'A';
  for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) {
    if (abOverride[mon]) ab = abOverride[mon];
    const d = dateOf(mon);
    const name = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;   // 例「12月14日」（「/」はExcel・Googleの取り込みで使えない）
    out.push({ monday: mon, name, ab, exists: existing.some((w) => w.monday === mon) });
    ab = ab === 'A' ? 'B' : 'A';
  }
  return out;
}

// ---------- ひな形のタブ ----------
/** 週案のタブの中の「1組」「2組」のかたまり、A週/B週のマス、日付の行、校時の行を見つける */
export function templateShape(sheet) {
  const get = (c, r) => norm(sheet.cells.get(colName(c) + r));
  let maxR = 0, maxC = 0;
  for (const ref of sheet.cells.keys()) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref); maxR = Math.max(maxR, Number(m[2]));
    let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; maxC = Math.max(maxC, n);
  }
  const classes = {}; let abCell = null;
  for (let r = 1; r <= Math.min(maxR, 4); r++) for (let c = 1; c <= maxC; c++) {
    const v = get(c, r);
    if (/^\d+組$/.test(v)) {
      const dayCols = {};
      for (let k = 1; k <= 7; k++) { const dv = get(c + k, r); if (DAYS.includes(dv)) dayCols[dv] = c + k; }
      if (Object.keys(dayCols).length === 5) classes[v] = { labelCol: c, headRow: r, dayCols, rows: {} };
    }
    if (!abCell && /^[AB]週$/.test(v)) abCell = colName(c) + r;
  }
  for (const cl of Object.values(classes)) {
    for (let r = cl.headRow + 1; r <= maxR; r++) {
      const lab = get(cl.labelCol, r);
      if (/^(朝学|朝学習|モジュール)$/.test(lab)) cl.rows['朝'] = r;
      else if (/^[1-6](\.0+)?$/.test(lab)) cl.rows[String(parseInt(lab, 10))] = r;
      else if (lab === '宿題') cl.rows['宿題'] = r;
    }
    // 書きこむ範囲：朝学の行から、宿題の行（なければ6校時の下の2行）まで
    const first = cl.rows['朝'] || cl.rows['1'];
    cl.lastRow = Math.max(cl.rows['宿題'] || 0, cl.rows['6'] ? cl.rows['6'] + 2 : 0);
    cl.firstRow = first;
  }
  return { classes, abCell };
}

/** ひな形にする週案のタブ：同じA週/B週の、いちばん新しい週のタブ（なければ「A週」などのタブ） */
export function pickTemplate(sheets, existing, ab) {
  const byName = new Map(sheets.map((s) => [s.name, s]));
  const recent = [...existing].reverse().find((w) => w.ab === ab && byName.has(w.name));
  if (recent) return byName.get(recent.name);
  const ok = sheets.filter((s) => Object.keys(templateShape(s).classes).length);
  const n = (s) => norm(s.name).replace(/\s/g, '');
  return ok.find((s) => n(s) === `${ab}週`) || ok.find((s) => n(s).includes(`${ab}週`)) || ok[0] || null;
}

/**
 * 1週分のタブのXMLを作る。ひな形の見た目（色・罫線・セルの結合・下の集計）はそのまま。
 * 月〜金のマス（朝学〜宿題）は空にしてから、日付・A週/B週・時間割の教科を入れる。
 * grids: { '1組': grid, '2組': grid }
 */
export function weekSheetXml(template, week, grids) {
  const shape = templateShape(template);
  const values = {}; const notes = [];
  if (shape.abCell) values[shape.abCell] = `${week.ab}週`; else notes.push('ひな形にA週/B週のマスがありません');
  for (const [cname, cl] of Object.entries(shape.classes)) {
    const cols = DAYS.map((d) => cl.dayCols[d]);
    // 前の週のメモ（単元名・先生の名前・宿題など）を消す
    if (cl.firstRow && cl.lastRow) {
      for (const ref of template.cells.keys()) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
        const r = Number(m[2]);
        if (cols.includes(c) && r >= cl.firstRow && r <= cl.lastRow) values[ref] = null;
      }
    }
    const grid = grids[cname];
    if (!grid) notes.push(`${cname}の時間割がありません`);
    DAYS.forEach((day, i) => {
      if (cl.headRow > 1) values[colName(cl.dayCols[day]) + (cl.headRow - 1)] = `${dateOf(addDays(week.monday, i)).getUTCDate()}日`;
      if (!grid) return;
      for (const slot of SLOTS) {
        const r = cl.rows[slot];
        if (r) values[colName(cl.dayCols[day]) + r] = toShuanWord(grid[day][slot], week.ab) || null;
      }
    });
  }
  // ほかのタブや絵とのつながり（r:id）は外す（取り込みでこわれないように）
  let xml = setCells(template.xml, values)
    .replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/g, '')
    .replace(/<(drawing|legacyDrawing|legacyDrawingHF|picture|tableParts)\b[^>]*\/>/g, '')
    .replace(/<tableParts\b[\s\S]*?<\/tableParts>/g, '')
    .replace(/<sheetView\b([^>]*?)\s*tabSelected="1"/g, '<sheetView$1');
  return { xml, notes };
}

/** 週のタブだけが入った新しいExcelファイル（Uint8Array）を作る */
export async function buildWeekBook(book, sheets /* [{name, xml}] */) {
  const f = book.files; const out = {};
  const ct = textOf(f['[Content_Types].xml']);
  const typeOf = (part) => (new RegExp(`<Override[^>]*PartName="/${part.replace(/[.]/g, '\\.')}"[^>]*>`).exec(ct) || [''])[0];
  const overrides = [];
  const keep = ['xl/styles.xml', 'xl/sharedStrings.xml', ...Object.keys(f).filter((p) => /^xl\/theme\/[^/]+\.xml$/.test(p))].filter((p) => f[p]);
  for (const p of keep) { out[p] = f[p]; const o = typeOf(p); if (o) overrides.push(o); }
  const rels = [];
  sheets.forEach((s, i) => {
    out[`xl/worksheets/sheet${i + 1}.xml`] = s.xml;
    overrides.push(`<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" PartName="/xl/worksheets/sheet${i + 1}.xml"/>`);
    rels.push(`<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
  });
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  if (out['xl/styles.xml']) rels.push(`<Relationship Id="rIdStyles" Type="${R}styles" Target="styles.xml"/>`);
  if (out['xl/sharedStrings.xml']) rels.push(`<Relationship Id="rIdStrings" Type="${R}sharedStrings" Target="sharedStrings.xml"/>`);
  Object.keys(out).filter((p) => p.startsWith('xl/theme/')).forEach((p, i) => rels.push(`<Relationship Id="rIdTheme${i + 1}" Type="${R}theme" Target="${p.slice(3)}"/>`));
  overrides.push('<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" PartName="/xl/workbook.xml"/>');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default ContentType="application/xml" Extension="xml"/><Default ContentType="application/vnd.openxmlformats-package.relationships+xml" Extension="rels"/>${overrides.join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R.slice(0, -1)}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rIdS${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    ...out,
  };
  return writeZip(files);
}
