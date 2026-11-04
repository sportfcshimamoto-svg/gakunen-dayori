// 先生が取り込んだ季節のイラストを、2ページ目に置く場所を決める。
// ・1枚は「下の空き」に大きく（空きが3.5cm以上あるとき）
// ・残りは小さく、記事の「見出しの横」か「記事の終わりの右」に自動で置く（11月号のたぬき・くまと同じ置き方）
// ・先生は記事ごとに置く絵を選び直したり、「なし」にしたりできる（sec.illTitle / sec.illEnd）
import { PAGE, LINE_CM, charWidth, choosePhotoLayout, fillIllustOf } from './docx-builder.js';

// 小さいイラストの大きさ（cm）。高さをそろえ、横長の絵は横幅の上限で縮める
export const SMALL = {
  title: { h: 1.3, maxW: 3.5 },   // 見出しの横（行の高さを変えない）
  end: { h: 1.9, maxW: 6 },       // 記事の終わりの右（約3行分の高さを使う）
};
const TITLE_PT = 18;

export function smallSize(kind, aspect) {
  const s = SMALL[kind];
  let h = s.h; let w = h * aspect;
  if (w > s.maxW) { w = s.maxW; h = w / aspect; }
  return [w, h];
}

/** 見出しの横に、その大きさの絵が入るか */
export function titleFits(title, w) {
  return charWidth(title || '') * LINE_CM * (TITLE_PT / 18) + 0.9 + w <= PAGE.textWidthCm - 0.2;
}

/**
 * @param d     Wordやプレビューに渡す内容（この中身を書きかえる）
 * @param pool  その月に取り込んだ絵 [{ id, aspect }]（取り込んだ順）
 * @param fns   { photoAspectOf, illustAspectOf }（2ページに収まるかの計算に使う）
 * @returns { fill: id|null, spots: [{ si, kind:'title'|'end', id, auto }] }  画面に「どこに何を置いたか」を出すため
 */
export function placeIllusts(d, pool, fns) {
  // pool の中の builtin：'fill'＝最初から入っている大きい絵、'small'＝最初から入っている小さい絵（どちらも白黒の線画なので白黒にしない）
  const ids = new Set(pool.map((p) => p.id));
  const itemOf = (id) => pool.find((p) => p.id === id);
  const aspectOf = (id) => itemOf(id).aspect;
  const valid = (v) => v && ids.has(v);
  const report = { fill: null, spots: [] };
  const own = pool.filter((p) => !p.builtin);
  const builtinFill = pool.find((p) => p.builtin === 'fill');
  d.grayIllusts = own.map((p) => p.id);

  // 1) 下の空きに大きく入れる絵（d.fillChoice：未指定＝自動［取り込んだ1枚目、なければ最初からある絵］、'default'＝最初からある絵、または絵のID）
  const fc = d.fillChoice;
  const fillId = valid(fc) ? fc : fc === 'default' || !own.length ? (builtinFill ? builtinFill.id : null) : own[0].id;
  if (fillId) { d.fillIllust = fillId; d.fillAspect = aspectOf(fillId); d.fillGray = !itemOf(fillId).builtin; report.fill = fillId; }

  // 2) 先生が選んだ置き場所（「なし」も含む）
  const used = new Set(fillId ? [fillId] : []);
  const secs = d.sections || [];
  const setSpot = (sec, si, kind, id, auto) => {
    const [w, h] = smallSize(kind, aspectOf(id));
    if (kind === 'title') { sec.titleIllust = id; sec.titleIllustSize = [w, h]; } else { sec.endIllust = id; sec.endIllustSize = [w, h]; }
    report.spots.push({ si, kind, id, auto });
    used.add(id);
  };
  secs.forEach((sec, si) => {
    for (const [kind, key, name] of [['title', 'illTitle', 'titleIllust'], ['end', 'illEnd', 'endIllust']]) {
      const c = sec[key];
      if (c === 'none') { delete sec[name]; delete sec[name + 'Size']; }
      else if (valid(c)) setSpot(sec, si, kind, c, false);
    }
  });

  // 3) 残った絵を、空いているところに自動で置く（1つの記事に1枚まで）
  // 先生が取り込んだ絵を先に、そのあとに最初から入っている小さい絵（d.builtinSmall === false なら使わない）
  const queue = [...own, ...pool.filter((p) => p.builtin === 'small' && d.builtinSmall !== false)].map((p) => p.id).filter((id) => !used.has(id));
  const fitOf = () => choosePhotoLayout(secs, fns.photoAspectOf, fns.illustAspectOf);
  const base = fitOf();
  const baseFill = fillIllustOf(d, base);
  for (let si = 0; si < secs.length && queue.length; si++) {
    const sec = secs[si];
    if (sec.titleIllust || sec.endIllust) continue;             // もう絵がある記事には足さない
    const hasPhotos = (sec.photos || []).length > 0;
    // 写真のない記事は終わりの右（文の下の空き）、写真のある記事は見出しの横を先に試す。
    // ただし、すぐ前の記事で終わりの右に置いたときは、続かないように見出しの横を先にする（11月号と同じ並び）
    const prev = report.spots[report.spots.length - 1];
    const afterEnd = prev && prev.si === si - 1 && prev.kind === 'end';
    const order = hasPhotos || afterEnd ? ['title', 'end'] : ['end', 'title'];
    for (const kind of order) {
      if (sec[kind === 'title' ? 'illTitle' : 'illEnd'] === 'none') continue;
      const id = queue[0];
      const [w] = smallSize(kind, aspectOf(id));
      if (kind === 'title' && !titleFits(sec.title, w)) continue;
      setSpot(sec, si, kind, id, true);
      if (kind === 'end') {
        // 記事の終わりの絵は高さを使うので、2ページに収まらなくなる・写真が小さくなるときはやめる
        const f = fitOf();
        // 下の空きの大きい絵が入らなくなるときもやめる
        if (!f.fits || f.scale < base.scale - 0.001 || (baseFill && !fillIllustOf(d, f))) {
          delete sec.endIllust; delete sec.endIllustSize; report.spots.pop(); used.delete(id);
          continue;
        }
      }
      queue.shift();
      break;
    }
  }
  return report;
}
