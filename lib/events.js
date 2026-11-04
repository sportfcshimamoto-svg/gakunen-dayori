// 年間行事予定（Excel）から、指定した学年・月の行事を取り出す。
// 自動で「載せる／載せない」を仮決めし、理由も付ける。最終判断は先生が画面で行う。
import { readXlsx, colIndex } from './xlsx-reader.js';

const CIRCLED = '①②③④⑤⑥';                // 学年の印（行事の頭に付く）
const COUNT_MARKS = /[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇]/g; // 回数（学年ではない）
const ALL = [1, 2, 3, 4, 5, 6];
const zen = (s) => String(s).replace(/[0-9a-zA-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const han = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 先生が後から変更できる初期設定
export const DEFAULT_RULES = {
  // 印がなくても特定の学年だけの行事
  gradeOnly: { '林間学校': [5], '修学旅行': [6] },
  // 初めから「載せない」にしておく言葉（画面でチェックを付ければ載せられる）
  excludeWords: ['SC', 'Jアラート', '放課後こども教室', '口座振替', '対象者', '職員', '研修', '予備日', '下見', '研究授業', '初任者'],
  // 祝日など
  holidayWords: ['元日', '成人の日', '建国記念の日', '天皇誕生日', '春分の日', '昭和の日', '憲法記念日', 'みどりの日',
    'こどもの日', '海の日', '山の日', '敬老の日', '秋分の日', 'スポーツの日', '文化の日', '勤労感謝の日', '振替休日', '国民の休日', '学校閉庁日'],
  // 呼び方の言いかえ（回数の印を消したあとの名前 → たよりでの書き方）
  rename: { '委員会': '委員会活動', 'クラブ': 'クラブ活動' },
};

// ---- 学年の印を読む ----
function parseMarks(s) {
  // 行頭の「③～⑥」「①②③」「④⑤⑥」「全学年」「⑥以外」「1年以外」「４年」
  let m;
  if ((m = /^([①-⑥])[～~〜]([①-⑥])/.exec(s))) {
    const a = CIRCLED.indexOf(m[1]) + 1; const b = CIRCLED.indexOf(m[2]) + 1;
    return finish(ALL.filter((g) => g >= a && g <= b), m[0].length, s);
  }
  if ((m = /^[①-⑥]+/.exec(s))) {
    const gs = [...m[0]].map((c) => CIRCLED.indexOf(c) + 1);
    return finish(gs, m[0].length, s);
  }
  if ((m = /^全学年/.exec(s))) return { grades: ALL.slice(), rest: s.slice(m[0].length) };
  if ((m = /^([1-6１-６])年(?!生?以外)/.exec(s))) return { grades: [Number(han(m[1]))], rest: s.slice(m[0].length) };
  if ((m = /^([1-6１-６])年生?以外/.exec(s))) {
    const g = Number(han(m[1])); return { grades: ALL.filter((x) => x !== g), rest: s.slice(m[0].length) };
  }
  return { grades: null, rest: s };
}
function finish(gs, len, s) {
  let rest = s.slice(len);
  if (rest.startsWith('以外')) return { grades: ALL.filter((g) => !gs.includes(g)), rest: rest.slice(2) };
  return { grades: gs, rest };
}

// 「1-1研究授業」「6-2以外」など、学級の指定（「1-3限」「10:20-11:25」は時間なので除く）
const CLASS_RE = /(^|[^0-9０-９:：時])([1-6])[-－‐−]([1-9])(?![0-9限時hｈ])/g;
const CLASS_EXCEPT_RE = /[1-6][-－‐−][1-9]以外[：:]?/g;

// 「(①②③3h,④⑤⑥3・4h)」のように、学年ごとに内容が違うかっこ書き
function gradeDetail(text, grade) {
  const m = /[（(]([^（）()]*[①-⑥][^（）()]*)[）)]/.exec(text);
  if (!m) return { text, applies: true };
  const groups = m[1].split(/[,，、]/).map((g) => g.trim()).filter(Boolean);
  const parsed = groups.map((g) => parseMarks(g));
  if (parsed.some((p) => !p.grades)) return { text, applies: true, warn: 'かっこ内の学年の書き方を確認してください' };
  const mine = parsed.find((p) => p.grades.includes(grade));
  if (!mine) return { text: text.replace(m[0], ''), applies: false };
  const detail = mine.rest.trim();
  return { text: text.replace(m[0], detail ? `（${zen(detail)}）` : ''), applies: true };
}

// ---- セルの文字を行事ごとに分ける ----
function splitItems(cell) {
  const out = [];
  for (const line of String(cell).split(/\r?\n/)) {
    let depth = 0; let cur = '';
    const push = () => { const t = cur.trim().replace(/^[　\s]+|[　\s]+$/g, ''); if (t) out.push(t); cur = ''; };
    for (const ch of line) {
      if (ch === '(' || ch === '（') depth++;
      if (ch === ')' || ch === '）') depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === '　' || ch === ' ' || ch === '\t')) { push(); continue; }
      cur += ch;
    }
    push();
  }
  // 「(①②③3h,…)」のように、かっこだけの行は前の行事の続き
  const merged = [];
  for (const it of out) {
    if (/^[（(]/.test(it) && merged.length) merged[merged.length - 1] += it;
    else merged.push(it);
  }
  return merged;
}

const DISMISS_RE = /([0-9０-９]{1,2}[:：][0-9０-９]{2})\s*下校|[0-9０-９]限後下校|[0-9０-９][hｈ]後下校/;

/** 1つの行事を、指定学年について判定する */
export function classifyItem(raw, grade, rules = DEFAULT_RULES) {
  const item = { raw, text: raw, grades: null, kind: 'event', include: true, reason: '', warn: '' };
  // 半角カタカナ（ｸﾗﾌﾞ）を全角に
  const src = raw.replace(/[｡-ﾟ]+/g, (s) => s.normalize('NFKC'));
  let { grades, rest } = parseMarks(src);
  let text = rest.trim();

  // 学級の指定（例：6-2以外13:15下校 → 5年生には「13:15下校」）
  const classes = [...text.matchAll(CLASS_RE)];
  if (classes.length) {
    const except = /以外/.test(text);
    const classGrades = [...new Set(classes.map((c) => Number(c[2])))];
    if (except) {
      if (!classGrades.includes(grade)) text = text.replace(CLASS_EXCEPT_RE, '');
      else item.warn = '一部の学級だけの予定です。内容を確認してください';
      grades = grades || ALL.slice();
    } else if (!grades) {
      grades = classGrades;
      if (classGrades.includes(grade)) item.warn = '一部の学級だけの予定です。内容を確認してください';
    }
  }

  // かっこ内の学年別の内容
  const gd = gradeDetail(text, grade);
  text = gd.text;
  if (gd.warn) item.warn = gd.warn;

  // 行事名の後ろの丸数字は、ふつうは回数（個人懇談①など）。学年の可能性もあるので確認を促す
  if (/[^①-⑥\s　][①-⑥]$/.test(text) && !/懇談[①-⑥]$/.test(text)) {
    item.warn = '後ろの丸数字が回数か学年か確認してください';
  }
  // 回数の印を消し、呼び方を整える
  text = text.replace(COUNT_MARKS, '').replace(/[（(]\d+[）)]$/, '').trim();
  if (rules.rename[text]) text = rules.rename[text];
  // 末尾の「2h」→「（２ｈ）」
  text = text.replace(/(\d+(?:・\d+)*)h$/, (_, n) => `（${zen(n)}ｈ）`);
  item.text = text;

  if (DISMISS_RE.test(text)) item.kind = 'dismissal';
  if (rules.holidayWords.some((w) => text.includes(w))) item.kind = 'holiday';

  // 印がない学年行事
  if (!grades) {
    for (const [word, gs] of Object.entries(rules.gradeOnly)) if (text.includes(word)) grades = gs;
  }
  item.grades = grades;

  // 載せる／載せないの仮決め
  if (grades && !grades.includes(grade)) { item.include = false; item.reason = `${grades.map((g) => g + '年').join('・')}の行事`; }
  else if (!gd.applies) { item.include = false; item.reason = 'この学年は対象外'; }
  else if (item.kind === 'holiday') { item.include = false; item.reason = '祝日・閉庁日'; }
  else {
    const w = rules.excludeWords.find((x) => text.includes(x));
    if (w) { item.include = false; item.reason = `「${w}」を含むため`; }
    else item.reason = grades ? `${grade}年の行事` : '全校の行事';
  }
  return item;
}

// ---- Excelファイルの読み込み ----
function findMaster(sheets) {
  for (const sh of sheets) {
    for (const r of [1, 2, 3, 4, 5]) {
      const row = sh.rows.get(r);
      if (!row) continue;
      const cols = {};
      for (const [c, v] of row) {
        const t = String(v).trim();
        if (t === '月') cols.month = c;
        else if (t === '日') cols.day = c;
        else if (t === '曜') cols.weekday = c;
        else if (t === '学校行事') cols.school = c;
        else if (t === '会議・研修等') cols.staff = c;
        else if (t === '地域行事') cols.community = c;
      }
      if (cols.month && cols.day && cols.school && cols.staff) return { sheet: sh, cols, headerRow: r };
    }
  }
  return null;
}

function schoolYearOf(sheetName, sheets) {
  const m = /R(\d+)/.exec(sheetName) || /令和\s*([0-9０-９]+)\s*年度/.exec(sheets.map((s) => [...s.rows.values()].map((r) => [...r.values()].join(' ')).join(' ')).join(' '));
  return m ? 2018 + Number(han(m[1])) : null;
}

/**
 * @returns { year, month, grade, days:[{day, weekday, items:[…]}], warnings:[…], sheetName }
 */
export async function extractEvents(xlsxBytes, { grade, month, rules = DEFAULT_RULES }) {
  const { sheets } = await readXlsx(xlsxBytes);
  const warnings = [];
  const found = findMaster(sheets);
  if (!found) throw new Error('「月・日・学校行事・会議・研修等」の見出しがあるシートが見つかりません。年間行事予定のファイルか確認してください。');
  const { sheet, cols, headerRow } = found;
  if (sheet.missingCache) warnings.push(`計算結果が保存されていないセルが${sheet.missingCache}個あります。Excelで一度開いて保存し直してください。`);
  const schoolYear = schoolYearOf(sheet.name, sheets);
  const year = schoolYear ? (month <= 3 ? schoolYear + 1 : schoolYear) : null;
  const days = [];
  const rowOfDay = new Map();
  // 4月〜3月の1年分だけを読む（表の下に翌年度の4月以降が続いていることがあるため）
  let started = false; let prevMonth = null;
  for (const [r, row] of [...sheet.rows].sort((a, b) => a[0] - b[0])) {
    if (r <= headerRow) continue;
    const m = Number(row.get(cols.month)); const d = Number(row.get(cols.day));
    if (!m || !d) continue;
    if (started && prevMonth === 3 && m === 4) break;
    started = true; prevMonth = m;
    if (m !== month) continue;
    if (rowOfDay.has(d)) continue;
    rowOfDay.set(d, row);
    const weekday = String(row.get(cols.weekday) || '').trim();
    if (year) {
      const real = '日月火水木金土'[new Date(year, month - 1, d).getDay()];
      if (weekday && weekday !== real) warnings.push(`${month}月${d}日の曜日が「${weekday}」になっていますが、カレンダーでは「${real}」です。`);
    }
    const cells = [row.get(cols.school), cols.community ? row.get(cols.community) : null].filter((v) => v && String(v).trim());
    const items = cells.flatMap((c) => splitItems(c)).map((raw) => classifyItem(raw, grade, rules));
    // その学年だけの下校時刻があれば、印のない下校時刻より優先する
    const mineDismiss = items.filter((i) => i.kind === 'dismissal' && i.include && i.grades);
    if (mineDismiss.length) {
      for (const i of items) {
        if (i.kind === 'dismissal' && i.include && !i.grades) { i.include = false; i.reason = `${grade}年の下校時刻が別にあるため`; }
      }
    }
    if (items.filter((i) => i.kind === 'dismissal' && i.include).length > 1) {
      items.filter((i) => i.kind === 'dismissal' && i.include).forEach((i) => { i.warn = 'この日は下校時刻が2つあります。確認してください'; });
    }
    days.push({ day: d, weekday, items });
  }
  if (!days.length) warnings.push(`${month}月の行が見つかりませんでした。`);

  // 月ごとのシート（例：「11」）と内容が食い違っていないか確認
  const monthSheet = sheets.find((s) => s.name.trim() === String(month));
  if (monthSheet) {
    const ms = findMonthSheetCols(monthSheet);
    if (ms) {
      for (const dd of days) {
        const row = [...monthSheet.rows.values()].find((rw) => Number(rw.get(ms.day)) === dd.day);
        const a = norm(row ? row.get(ms.school) : '');
        const src = rowOfDay.get(dd.day);
        // 月のシートは「学校行事」と「地域行事」をつなげて表示している
        const b = norm(String(src.get(cols.school) || '') + String(cols.community ? src.get(cols.community) || '' : ''));
        if (a !== b) warnings.push(`${month}月${dd.day}日：シート「${sheet.name}」とシート「${monthSheet.name}」で行事の内容が違います。どちらが正しいか確認してください。`);
      }
    }
  }
  return { year, month, grade, days, warnings, sheetName: sheet.name };
}
const norm = (s) => String(s || '').replace(/[\s　]+/g, '');
function findMonthSheetCols(sh) {
  for (const r of [3, 4, 5, 6]) {
    const row = sh.rows.get(r); if (!row) continue;
    let day = null; let school = null;
    for (const [c, v] of row) { if (String(v).trim() === '日') day = c; if (String(v).trim() === '学校行事') school = c; }
    if (day && school) return { day, school };
  }
  return null;
}

/** 画面での確認後、学年だよりに載せる形（日付ごとに1行）にする */
export function toNewsletterEvents(result) {
  const out = [];
  for (const d of result.days) {
    const inc = d.items.filter((i) => i.include);
    if (!inc.length) continue;
    const events = inc.filter((i) => i.kind !== 'dismissal').map((i) => i.text);
    const dismiss = inc.filter((i) => i.kind === 'dismissal').map((i) => i.text);
    out.push({ day: d.day, weekday: d.weekday, text: [...events, ...dismiss].join('　'), dismissal: dismiss.join('　') });
  }
  return out;
}

export { colIndex };
