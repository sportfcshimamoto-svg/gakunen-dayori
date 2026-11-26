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
  function convCell(raw) {
    const c = String(raw || '').trim();
    if (!c) return { text: '', pair: null };
    const m = /^(.*?)\s*[（(](.*)[)）]\s*$/.exec(c);
    if (!m) { const n = norm(c); return { text: SUBJ[n] || n, pair: null }; }
    const subs = m[2].split(/[、,，]/).map(norm).filter(Boolean);
    if (subs.includes('図書')) return { text: '図書', pair: null }; // 「国語、図書」→ 図書
    if (subs.length === 1) return { text: SUBJ[subs[0]] || subs[0], pair: null };
    const pair = subs.slice(0, 2).map((x) => HALF[x] || x[0]);
    return { text: pair.join('/'), pair };
  }

  // 表（行×列の文字）を読む。読めなければ null
  function readIdea(rows) {
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
      classes.push({ name, raws, cells: raws.map(convCell) });
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

  root.JikanwariCore = { SLOTS, convCell, readIdea, cellText, flipKey };
})(typeof window !== 'undefined' ? window : globalThis);
