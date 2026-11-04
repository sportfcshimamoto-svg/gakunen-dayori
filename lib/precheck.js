// 発行前の自動チェック：「Wordファイルを作る」の前に、気になるところをまとめて知らせる。
// どれもお知らせだけ（先生が「このまま作る」を選べば、そのまま作れる）。
import { sectionRows, layoutSectionRow, LINE_CM } from './docx-builder.js';
import { findNames, AI_PREFACE, isAiAfterword } from './ai-prompt.js';

const PHOTO_MIN_CM = 2.5;   // 写真の短い辺がこれより小さいと「小さすぎる」

/**
 * @param d    Wordに渡す形の学年だよりの内容（newsletterData()）
 * @param fit  2ページに収まっているかの計算（app.js の checkFit の結果）
 * @param ctx  { curriculum: その学年のカリキュラム, lastIssued: 前にWordを作った号の文（app.js が保存）, photoAspectOf, illustAspectOf }
 * @returns [{ tab, title, detail }]  tab：直す場所のタブ
 */
export function precheck(d, fit, ctx = {}) {
  const out = [];
  const add = (tab, title, detail = '') => out.push({ tab, title, detail });
  const m = Number(d.month);

  // 1. はみ出し
  if (fit.room1 < 0) add('greeting', `1ページ目が約${Math.ceil(-fit.room1 / LINE_CM)}行はみ出しています`, 'あいさつ・行事予定・学習予定のどれかを短くしてください。');
  if (!fit.fit.fits) add('page2', '2ページ目がはみ出しています', '記事か写真を減らすか、写真の「1行の枚数」を増やしてください。');

  // 2. 学校名・発行日
  if (!String(d.school || '').trim()) add('basic', '学校名が空です');
  if (!d.issueDate) add('basic', '発行日が空です');

  // 3. 発行日と「何月号」（発行日は、その月か前の月のはず。例：11月号は10月末か11月）
  if (d.issueDate) {
    const im = Number(String(d.issueDate).split('-')[1]);
    const prev = m === 1 ? 12 : m - 1;
    if (im !== m && im !== prev) add('basic', `発行日（${im}月）が「${m}月号」と合っていません`, `${m}月号なら、発行日はふつう${prev}月か${m}月です。`);
  }

  // 4. 行事予定が0件
  if (!(d.events || []).length) add('events', '行事予定が1件もありません', 'Excelを読み込むか、日にちを指定して行事を足してください。');

  // 5. 学習予定が空の教科
  const learning = d.learning || [];
  const empty = learning.filter((it) => it.label && !it.lines.length).map((it) => it.label);
  if (!learning.some((it) => it.lines.length)) add('learning', '学習予定が空です');
  else if (empty.length) add('learning', `学習予定が空の教科があります：${empty.join('・')}`, '書かない教科なら、③で教科ごと消してください（枠には「教科名：」だけが出ます）。');

  // 6. カリキュラムがサンプルのまま
  const sampleLines = learning.flatMap((it) => it.lines).filter((l) => l.includes('サンプル'));
  if (sampleLines.length) add('learning', '学習予定に「サンプル（仮のデータ）」の文字が入っています', `例：「${sampleLines[0]}」。本物のカリキュラムを⑥で読み込んで、入れ直してください。`);
  else if (ctx.curriculum && ctx.curriculum.sample) add('curriculum', '⑥のカリキュラムが、まだサンプル（仮のデータ）です', '学習予定には入っていませんが、本物が届いたら読み込み直してください。');

  // 本文（あいさつ・記事）を、場所の名前つきで集める
  const texts = [
    ...(d.greeting || []).map((t) => ({ tab: 'greeting', where: 'あいさつ', t })),
    ...(d.sections || []).flatMap((s) => [
      { tab: 'page2', where: `記事「${s.title || '見出しなし'}」の見出し`, t: s.title || '' },
      ...(s.paragraphs || []).map((t) => ({ tab: 'page2', where: `記事「${s.title || '見出しなし'}」`, t })),
    ]),
    ...(d.events || []).map((e) => ({ tab: 'events', where: `行事予定（${e.day}日）`, t: e.text })),
    ...learning.flatMap((it) => it.lines.map((t) => ({ tab: 'learning', where: `学習予定（${it.label}）`, t }))),
  ];

  // 7. 前の号の文が残っていないか（例：12月号に、11月号のあいさつがそのまま）。
  //    「10月の稲刈りでは」のように前の月を書くのはふつうなので、「N月」の文字ではなく、前にWordを作った号の文と比べる
  const last = ctx.lastIssued;
  if (last && Number(last.month) !== m) {
    const norm = (s) => String(s).replace(/[\s　]/g, '');
    const old = new Set([...(last.greeting || []), ...(last.sections || []).flatMap((s) => s.paragraphs || [])].map(norm).filter((s) => s.length >= 10));
    const hits = texts.filter((x) => (x.tab === 'greeting' || x.tab === 'page2') && old.has(norm(x.t)));
    const oldLearn = (last.learning || []).map(norm).join('\n');
    const sameLearn = oldLearn && learning.flatMap((it) => it.lines).map(norm).join('\n') === oldLearn;
    const where = uniq([...hits.map((x) => x.where), ...(sameLearn ? ['学習予定'] : [])]);
    if (where.length) add(hits.length ? hits[0].tab : 'learning', `前の号（${last.month}月号）と同じ文が残っています（${where.join('、')}）`, `${m}月号の内容に書きかえたか確かめてください。わざと同じにしたのなら、このままでかまいません。`);
  }

  // 8. 子どもの名前らしい書き方
  const names = texts.flatMap((x) => findNames(x.t).map((n) => ({ ...x, n })));
  if (names.length) add(names[0].tab, `子どもの名前のような書き方があります：${uniq(names.map((x) => `「${x.n}」`)).join('')}`, `場所：${uniq(names.map((x) => x.where)).join('、')}。名前を載せてよいか確かめてください。`);

  // 9. AIの返事の前置き・あとがき・記号の残り
  const blocks = [{ tab: 'greeting', where: 'あいさつ', ps: d.greeting || [] },
    ...(d.sections || []).map((s) => ({ tab: 'page2', where: `記事「${s.title || '見出しなし'}」`, ps: s.paragraphs || [] }))];
  const aiHits = blocks.filter((b) => b.ps.length && (AI_PREFACE.test(b.ps[0].trim()) || isAiAfterword(b.ps[b.ps.length - 1].trim())
    || b.ps.some((p) => /\*\*|^\s*#|```/.test(p))));
  if (aiHits.length) add(aiHits[0].tab, `AIの返事の前置きや記号が残っているかもしれません（${aiHits.map((b) => b.where).join('、')}）`, '「以下が文章です」「修正のご希望があれば」「**」などが入っていないか確かめてください。');

  // 10. 写真が小さくなりすぎていないか
  if (ctx.photoAspectOf) {
    const small = [];
    for (const sec of d.sections || []) {
      if (!(sec.photos || []).length) continue;
      const rows = sectionRows({ ...sec, _perRow: fit.fit.perRow }, fit.fit.perRow);
      const info = (it) => (it.photo ? ctx.photoAspectOf(it.photo) : ctx.illustAspectOf(it.illust));
      const min = Math.min(...rows.flatMap((row) => layoutSectionRow(row, sec, info, fit.fit.scale || 1).filter((i) => i.photo).map((i) => Math.min(i.w, i.h))));
      if (min < PHOTO_MIN_CM) small.push(`「${sec.title || '見出しなし'}」（約${min.toFixed(1)}cm）`);
    }
    if (small.length) add('page2', `写真が小さくなっています：${small.join('、')}`, '写真の数を減らすか、記事の文を短くしてください（写真の短い辺が2.5cmより小さいと、顔が見分けにくくなります）。');
  }
  return out;
}

const uniq = (a) => [...new Set(a)];
