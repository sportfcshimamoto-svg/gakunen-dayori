// イラストを2ページ目に置く場所を決める（11/26 作り直し：大きくして下の空きを埋めるのはやめた）。
// ・その月のイラスト（「学年だよりイラスト」＞「〇月」フォルダから読み込んだ絵）を、まず記事の
//   「見出しの横」か「記事の終わりの右」に小さく、1つの記事に1枚まで自動で置く（11月号のたぬき・くまと同じ置き方）
// ・残った絵は、2ページ目の下の空きに、ふつうの大きさで横に並べる（入るだけ）
// ・その月の絵がないときは、アプリに最初から入っている小さい絵を使う
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
 * @param pool  その月の絵 [{ id, aspect, builtin? }]（builtin：'small'＝最初から入っている小さい絵）
 * @param fns   { photoAspectOf, illustAspectOf }（2ページに収まるかの計算に使う）
 * @returns { spots: [{ si, kind:'title'|'end', id }], bottom: [id] }  画面に「どこに何を置いたか」を出すため
 */
export function placeIllusts(d, pool, fns) {
  const own = pool.filter((p) => !p.builtin);
  const use = own.length ? own : pool.filter((p) => p.builtin === 'small');
  const aspectOf = (id) => pool.find((p) => p.id === id).aspect;
  const report = { spots: [], bottom: [] };
  d.grayIllusts = own.map((p) => p.id);   // 読み込んだ絵はWordで白黒（最初からある絵はもともと白黒の線画）
  const secs = d.sections || [];
  const queue = use.map((p) => p.id);
  const fitOf = () => choosePhotoLayout(secs, fns.photoAspectOf, fns.illustAspectOf);
  const base = fitOf();
  for (let si = 0; si < secs.length && queue.length; si++) {
    const sec = secs[si];
    if (sec.titleIllust || sec.endIllust) continue;
    const hasPhotos = (sec.photos || []).length > 0;
    // 写真のない記事は終わりの右（文の下の空き）、写真のある記事は見出しの横を先に試す。
    // すぐ前の記事で終わりの右に置いたときは、続かないように見出しの横を先にする（11月号と同じ並び）
    const prev = report.spots[report.spots.length - 1];
    const afterEnd = prev && prev.si === si - 1 && prev.kind === 'end';
    const order = hasPhotos || afterEnd ? ['title', 'end'] : ['end', 'title'];
    for (const kind of order) {
      const id = queue[0];
      const [w, h] = smallSize(kind, aspectOf(id));
      if (kind === 'title' && !titleFits(sec.title, w)) continue;
      if (kind === 'title') { sec.titleIllust = id; sec.titleIllustSize = [w, h]; } else { sec.endIllust = id; sec.endIllustSize = [w, h]; }
      if (kind === 'end') {
        // 記事の終わりの絵は高さを使うので、2ページに収まらなくなる・写真が小さくなるときはやめる
        const f = fitOf();
        if (!f.fits || f.scale < base.scale - 0.001) { delete sec.endIllust; delete sec.endIllustSize; continue; }
      }
      report.spots.push({ si, kind, id });
      queue.shift();
      break;
    }
  }
  // 残った絵は、下の空きにふつうの大きさで並べる
  d.bottomIllusts = queue;
  d.bottomAspects = Object.fromEntries(queue.map((id) => [id, aspectOf(id)]));
  const b = fillIllustOf(d, fitOf());
  report.bottom = b ? b.rows.flat().map((x) => x.name) : [];
  return report;
}
