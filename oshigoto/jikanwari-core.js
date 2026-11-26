// イデアの「＜クラスの授業時間割一覧＞」txt を、時間割スプレッドシートの一覧表（C3から右）の形にする。
// 一覧表：A列＝クラス、B列＝担任、C〜AE列＝月1〜6・火1〜6・水1〜5・木1〜6・金1〜6（ほかのシートは一覧表を式で見ている）
// ページ（jikanwari.js）と、確かめ用のスクリプトの両方で使う。
(function (root) {
  const SLOTS = [['月', 6], ['火', 6], ['水', 5], ['木', 6], ['金', 6]];

  // 教科の書き方（一覧表の書き方にそろえる）
  const SUBJ = { '図画工作': '図工', '総合的学習': '総合', '総合的な学習の時間': '総合', '特別活動': '特活', '外国語活動': '外国語' };
  const HALF = { '図画工作': '図', '総合的学習': '総', '音楽': '音', '家庭': '家', '理科': '理', '社会': '社', '国語': '国', '算数': '算', '体育': '体', '生活': '生', '外国語': '外', '図書': '図書', '書写': '書' };
  const norm = (s) => String(s || '').normalize('NFKC').replace(/[‐－−―ー]/g, '-').replace(/\s+/g, ' ').trim();

  // 1マスを変える。「5年図家 (図画工作、家庭 )」→ { text:'図/家', pair:['図','家'] }
  // opts：{ tosho: 図書の書き方（'図書' か '国（図書）'）, club: クラブの書き方（'クラブ' か 'ク・委'） }
  function convCell(raw, opts) {
    const o = opts || {};
    const c = String(raw || '').trim();
    if (!c) return { text: '', pair: null };
    if (/プール/.test(c)) return { text: 'プール', pair: null }; // 「1と6年プール (体育 )」→ プール
    const m = /^(.*?)\s*[（(](.*)[)）]\s*$/.exec(c);
    const one = (x) => x === '図書' ? (o.tosho || '図書') : x === 'クラブ' ? (o.club || 'クラブ') : (SUBJ[x] || x);
    if (!m) return { text: one(norm(c)), pair: null };
    const subs = m[2].split(/[、,，]/).map(norm).filter(Boolean);
    if (subs.includes('図書')) return { text: one('図書'), pair: null }; // 「国語、図書」→ 図書
    if (subs.length === 1) return { text: one(subs[0]), pair: null };
    const pair = subs.slice(0, 2).map((x) => HALF[x] || x[0]);
    return { text: pair.join('/'), pair };
  }

  // 表（行×列の文字）を読む。読めなければ null
  function readIdea(rows, opts) {
    const isDay = (s) => /^(月|火|水|木|金|土|日)(曜日?)?$/.test(norm(s));
    const hr = rows.findIndex((r) => r.filter(isDay).length >= 5);
    if (hr < 0 || !rows[hr + 1]) return null;
    const head = rows[hr], per = rows[hr + 1];
    // 曜日ごとに、何列目が何時間目か
    const dayCols = {};
    let curDay = null;
    head.forEach((c, i) => {
      if (isDay(c)) curDay = norm(c)[0];
      const p = parseInt(norm(per[i]), 10);
      if (curDay && p > 0) (dayCols[curDay] = dayCols[curDay] || {})[p] = i;
    });
    if (!SLOTS.every(([d]) => dayCols[d])) return null;
    const labels = SLOTS.flatMap(([d, n]) => Array.from({ length: n }, (_, k) => d + (k + 1)));
    const classes = [], dropped = [];
    for (const r of rows.slice(hr + 2)) {
      const name = norm(r[0]);
      if (!name || r.slice(1).every((c) => !String(c || '').trim())) continue;
      const raws = SLOTS.flatMap(([d, n]) => Array.from({ length: n }, (_, k) => { const i = dayCols[d][k + 1]; return i == null ? '' : String(r[i] || '').trim(); }));
      // 一覧表にない時間（水曜6時間目など）に授業があれば知らせる
      for (const [d, cols] of Object.entries(dayCols)) for (const [p, i] of Object.entries(cols)) {
        const slot = SLOTS.find(([x]) => x === d);
        if ((!slot || +p > slot[1]) && String(r[i] || '').trim()) dropped.push(`${name} ${d}${p}「${String(r[i]).trim()}」`);
      }
      classes.push({ name, raws, cells: raws.map((x) => convCell(x, opts)) });
    }
    if (!classes.length) return null;
    // 2つの教科を半分ずつする授業（理/図など）を、同じ時間に2クラスで分けるとき（「3-12理図」など）は、
    // 2つめのクラスを逆にする（1組が理科のとき2組は図工）
    labels.forEach((_, j) => {
      const seen = {};
      classes.forEach((c) => {
        const cell = c.cells[j]; if (!cell.pair) return;
        const k = c.raws[j]; seen[k] = (seen[k] || 0) + 1;
        if (seen[k] % 2 === 0) { cell.pair = [cell.pair[1], cell.pair[0]]; cell.text = cell.pair.join('/'); cell.auto = true; }
      });
    });
    return { title: norm(rows.find((r) => r.some((c) => String(c).trim()))?.find((c) => String(c).trim()) || ''), labels, classes, dropped };
  }

  // 押して入れかえたマスを反映した値
  function cellText(cls, j, flips) {
    const cell = cls.cells[j];
    if (!cell.pair) return cell.text;
    return flips && flips.has(flipKey(cls, j)) ? [cell.pair[1], cell.pair[0]].join('/') : cell.text;
  }
  const flipKey = (cls, j) => `${cls.name}|${j}|${cls.raws[j]}`;

  // ---- 先生の行 ----
  // 教科の記号（先生の行に書く1字）。図書は「書」で選ぶが、書くときは学級だけ（図書の先生は専科の書き方）
  const CODE = { '国語': '国', '算数': '算', '理科': '理', '社会': '社', '体育': '体', '音楽': '音', '図工': '図', '家庭': '家', '外国語': '外', '生活': '生', '総合': '総', '図書': '書', '道徳': '道', '特活': '特', 'クラブ': 'ク', '書写': '習', 'プール': 'プ', '国（図書）': '書', 'ク・委': 'ク' };
  const CODE_NAME = { 国: '国語', 算: '算数', 理: '理科', 社: '社会', 体: '体育', プ: 'プール', 音: '音楽', 図: '図工', 家: '家庭', 外: '外国語', 生: '生活', 総: '総合', 書: '図書', 道: '道徳', 特: '特活', ク: 'クラブ', 習: '書写' };
  const codeOf = (s) => CODE[s] || s;
  const gradeOf = (name) => (/^(\d+)/.exec(name) || [])[1] || name;
  const FW = (s) => s.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xFEE0)).replace(/-/g, '－');

  // あるマスで、そのクラスがする授業（[{code, half}]。half：0＝まるごと、1＝前半、2＝後半）
  function lessonsAt(cls, j, flips) {
    const v = cellText(cls, j, flips); if (!v) return [];
    if (cls.cells[j].pair) return v.split('/').map((s, k) => ({ code: codeOf(s), half: k + 1 }));
    return [{ code: codeOf(v), half: 0 }];
  }
  // txtにある（クラス・教科）と、その授業名（イデアの名前）
  function subjectsIn(t, flips) {
    const codes = [], names = {};
    t.classes.forEach((c) => t.labels.forEach((_, j) => lessonsAt(c, j, flips).forEach(({ code }) => {
      if (!codes.includes(code)) codes.push(code);
      const k = `${c.name}|${code}`; (names[k] = names[k] || new Set()).add(c.raws[j]);
    })));
    const order = Object.keys(CODE_NAME);
    codes.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    return { codes, names };
  }
  // 決まった予定の時間を、マスの番号に。「火2 金1」のほか、「道徳 特活」のように教科の名前でもよい（その教科があるクラスがある時間）
  function slotsOf(t, s) {
    const out = new Set();
    for (const tok of String(s || '').normalize('NFKC').split(/[\s・、,]+/).filter(Boolean)) {
      const m = /^(月|火|水|木|金)(\d)$/.exec(tok);
      if (m) { const j = t.labels.indexOf(m[1] + m[2]); if (j >= 0) out.add(j); continue; }
      const code = CODE[tok] || CODE[SUBJ[tok]] || (CODE_NAME[tok] ? tok : null); if (!code) continue;
      t.labels.forEach((_, j) => { if (t.classes.some((c) => lessonsAt(c, j).some((x) => x.code === code))) out.add(j); });
    }
    return [...out];
  }
  // 前の設定（noSubj・halfNoSubj）を、いまの設定（omit・halfStyle）に
  const omitOf = (te) => te.omit != null ? te.omit : te.noSubj ? 'all' : '';
  const halfStyleOf = (te) => te.halfStyle || (te.halfNoSubj ? 'none' : 'each');
  // 先生1人の行（29マス）を作る
  // teacher = { label, picks: ['4-1|理', ...], excl: ['2年音楽 (音楽 )', ...],
  //   omit: 書かない教科（''＝全部書く、'all'＝全部書かない〔音楽・図書など〕、'理' など＝その教科だけ書かない〔理専の「５－１」〕）,
  //   halfStyle: 半分ずつの授業の書き方（'each'＝3-1理/3-2理、'none'＝3-1/3-2、'end'＝3-1/3-2理）,
  //   fixed: [{ slots: '道徳 特活', text: '支援担会議' }] }
  function teacherRow(t, teacher, flips) {
    const picks = new Set(teacher.picks || []), excl = new Set(teacher.excl || []);
    const fixed = {}; (teacher.fixed || []).forEach((f) => { if (f.text) slotsOf(t, f.slots).forEach((j) => { fixed[j] = f.text; }); });
    const byGrade = {}; t.classes.forEach((c) => { (byGrade[gradeOf(c.name)] = byGrade[gradeOf(c.name)] || []).push(c.name); });
    return t.labels.map((_, j) => {
      const whole = [], halves = [[], []]; // whole：[{cls, code, raw}]
      t.classes.forEach((c) => {
        if (excl.has(c.raws[j])) return;
        lessonsAt(c, j, flips).forEach(({ code, half }) => {
          if (!picks.has(`${c.name}|${code}`)) return;
          if (half) halves[half - 1].push({ cls: c.name, code }); else whole.push({ cls: c.name, code, raw: c.raws[j] });
        });
      });
      const omit = omitOf(teacher), hs = halfStyleOf(teacher);
      const subj = (code) => omit === 'all' || omit === code ? '' : (code === '書' ? '図書' : code);
      const parts = [];
      // まるごとの授業：教科ごとにまとめる。学年の全部のクラスなら「５年算」、2学年いっしょなら「1,2年国」、1クラスなら「４－１理」、
      // いくつかのクラスなら「3-1,6-2社」「3-1,2社」
      const groups = [];
      whole.forEach((w) => { let g = groups.find((x) => x.code === w.code); if (!g) groups.push(g = { code: w.code, cls: [] }); if (!g.cls.includes(w.cls)) g.cls.push(w.cls); });
      const wholeParts = groups.map((g) => {
        const grades = [...new Set(g.cls.map(gradeOf))];
        const full = (gr) => byGrade[gr].length > 1 && byGrade[gr].every((n) => g.cls.includes(n));
        if (grades.every(full)) return grades.length > 1 ? `${grades.join(',')}年${subj(g.code)}` : FW(`${grades[0]}年`) + subj(g.code);
        if (g.cls.length === 1) return FW(g.cls[0]) + subj(g.code);
        return grades.map((gr) => full(gr) ? `${gr}年` : `${gr}-${g.cls.filter((n) => gradeOf(n) === gr).map((n) => n.slice(gr.length + 1)).join(',')}`).join(',') + subj(g.code);
      });
      // 2つ以上の教科をならべるときは半角で「3-2,3社,6-2国」
      if (wholeParts.length) parts.push(wholeParts.length > 1 ? wholeParts.map((x) => x.normalize('NFKC')).join(',') : wholeParts[0]);
      if (halves[0].length || halves[1].length) {
        const strs = halves.map((h) => h.map((x) => x.cls + (hs === 'each' ? subj(x.code) : '')).join('・'));
        if (hs === 'end') { const k = halves[1].length ? 1 : 0; strs[k] += subj(halves[k][halves[k].length - 1].code); }
        parts.push(strs.join('/'));
      }
      if (fixed[j]) parts.push(fixed[j]);
      return parts.join('・');
    });
  }

  // はじめの先生の行（2026年度の時間割の一覧表と同じ。名前は入れない）。sel：学年（'4'）かクラス（'6-1'）→ 教科の記号
  const MEETING = [{ slots: '道徳 特活', text: '支援担会議' }]; // 道徳・特活は全クラス同じ時間（担任が教室にいる時間）
  const PRESET = [
    { label: '支援①', sel: { 4: '理算', 5: '理算' }, fixed: MEETING },
    { label: '支援②', sel: { 1: '国図', 2: '国図' }, fixed: MEETING },
    { label: '支援③', sel: { 4: '国社', 5: '国社' }, fixed: MEETING },
    { label: '支援④', sel: { 2: '体算', 3: '理算' }, fixed: MEETING, halfStyle: 'none' },
    { label: '支援⑤', sel: { 3: '国社', '6-1': '国社', '6-2': '国社' }, fixed: MEETING },
    { label: '支援⑥', sel: { 1: '体算', 6: '算', '6-1': '理', '6-2': '理' }, fixed: MEETING },
    { label: '支援員', sel: {} },
    { label: '首席', sel: { 4: '算', 6: '理' } },
    { label: '音楽', sel: { 2: '音', 3: '音', 4: '音', 5: '音', 6: '音' }, omit: 'all', excl: ['2年音楽 (音楽 )'] },
    { label: '理専', sel: { 4: '理', 5: '理算' } },
    { label: '軽減', sel: { 3: '理' }, halfStyle: 'none' },
    { label: '外国語', sel: { 5: '外', 6: '外' }, omit: 'all' },
    { label: '図書', sel: { 1: '書', 2: '書', 3: '書', 4: '書', 5: '書', 6: '書' }, omit: 'all' },
  ];
  // sel を、いまのtxtのクラスで picks（'4-1|理'）にする
  function expandSel(t, sel) {
    const picks = [];
    for (const [k, codes] of Object.entries(sel || {})) {
      const names = t.classes.map((c) => c.name).filter((n) => n === k || gradeOf(n) === k);
      for (const n of names) for (const code of codes) picks.push(`${n}|${code}`);
    }
    return picks;
  }
  const presetTeachers = (t) => PRESET.map((p) => ({ label: p.label, picks: expandSel(t, p.sel), excl: p.excl || [], omit: p.omit || '', halfStyle: p.halfStyle || 'each', fixed: (p.fixed || []).map((f) => ({ ...f })) }));

  root.JikanwariCore = { SLOTS, convCell, readIdea, cellText, flipKey, CODE_NAME, subjectsIn, teacherRow, gradeOf, presetTeachers, PRESET, omitOf, halfStyleOf };
})(typeof window !== 'undefined' ? window : globalThis);
