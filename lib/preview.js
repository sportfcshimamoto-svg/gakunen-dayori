// 学年だよりの画面用プレビュー（A4・2ページ）。Wordと同じ寸法・フォントで、HTMLとして描く。
// Wordの仕上がりと完全には同じにならないが、行の数や配置はほぼ同じになるようにしている。
import {
  PAGE, ILLUST_SIZE, LINE_CM, toZenkaku, formatIssueDate, headImagesOf, fitSize, charWidth, sectionRows, layoutSectionRow,
  titleIllustSizeOf, endIllustSizeOf, eventsIllustNameOf, eventsIllustSizeOf,
} from './docx-builder.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const richText = (s) => esc(s).replace(/__(.+?)__/g, '<u>$1</u>');
const cm = (n) => `${Math.round(n * 1000) / 1000}cm`;
const box = (b) => `left:${cm(b.x)};top:${cm(b.y)};width:${cm(b.w)};height:${cm(b.h)}`;

/**
 * @param data      学年だよりの内容（buildDocx と同じ形）
 * @param urlOf     イラスト名 → 画像のURL
 * @param photoOf   写真ID → { url, width, height }（なければ null）
 * @param layout    { perRow, scale }（写真の並べ方。choosePhotoLayout の結果）
 */
export function renderPreview(data, urlOf, photoOf = () => null, layout = { perRow: 3, scale: 1 }) {
  return `<div class="page">${page1(data, urlOf)}</div><div class="page">${page2(data, urlOf, photoOf, layout)}</div>`;
}

function page1(data, urlOf) {
  const B = PAGE.boxes;
  const heads = headImagesOf(data.month);
  const he = data.headEventsImage || heads.events; const hl = data.headLearningImage || heads.learning;
  const logo = data.logo === undefined ? 'logo.png' : data.logo;   // null ならロゴなし
  let h = '<div class="body">';
  // ヘッダー（6行分）
  h += `<div class="p-header" style="height:${cm(LINE_CM * 6)}">`
    + `<div class="p-hbox" style="${box(PAGE.headerBox)}"><div class="p-htext">`
    + `<div style="font-size:11pt">&nbsp;</div><div style="font-size:11pt;padding-right:0.37cm">${esc(data.school)}　　　　　</div>`
    + `<div style="font-size:11pt;padding-right:0.39cm">${esc(toZenkaku(data.grade))}年生　学年だより</div>`
    + `<div style="font-size:9pt">${data.issueDate ? esc(formatIssueDate(data.issueDate)) : ''}</div></div></div>`
    + (logo ? `<img class="abs" src="${urlOf(logo)}" style="${box(PAGE.logo)};object-fit:contain" alt="">` : '') + '</div>';
  // あいさつ
  for (const g of data.greeting || []) h += `<p class="indent">${esc(String(g).replace(/^[\s　]+/, ''))}</p>`;
  h += '<p>&nbsp;</p>';
  // 見出しイラスト（1行＋空き2行）
  h += `<div class="p-heads" style="height:${cm(LINE_CM)}"><img class="abs" src="${urlOf(he)}" style="${box(PAGE.headEvents)}" alt="">`
    + `<img class="abs" src="${urlOf(hl)}" style="${box(PAGE.headLearning)}" alt=""></div><p>&nbsp;</p><p>&nbsp;</p>`;
  // 行事予定・学習予定の枠
  const innerL = B.leftW - B.padCm * 2; const innerR = B.rightW - B.padCm * 2;
  const ill = eventsIllustNameOf(data);
  const [iw, ih] = ill ? eventsIllustSizeOf(data, ill) : [0, 0];
  const events = (data.events || []).map((e) => {
    const day = toZenkaku(e.day);
    const label = `${day.length < 2 ? '　' : ''}${day}日（${e.weekday}）`;
    const size = fitSize(label + e.text, 0, innerL);
    return `<p style="font-size:${size}pt">${esc(label)}${esc(e.text)}</p>`;
  }).join('');
  const learning = (data.learning || []).map((it) => {
    const label = `${it.label}：`; const ind = charWidth(label);
    const lines = it.lines && it.lines.length ? it.lines : [''];
    return lines.map((line, i) => {
      const size = fitSize(line, ind, innerR);
      return `<p class="hang" style="padding-left:${ind}em;text-indent:${i ? 0 : -ind}em"><span style="font-size:10.5pt">${i ? '' : esc(label)}</span><span style="font-size:${size}pt">${esc(line)}</span></p>`;
    }).join('');
  }).join('');
  h += `<div class="p-boxes" style="margin-left:${cm(B.indentCm)};min-height:${cm(B.heightCm)}">`
    + `<div class="p-box" style="width:${cm(B.leftW)};padding:0.1cm ${cm(B.padCm)}"><div class="grow">${events}</div>`
    + `<div class="p-ill">${ill ? `<img src="${urlOf(ill)}" style="width:${cm(iw)};height:${cm(ih)}${(data.grayIllusts || []).includes(ill) ? ';filter:grayscale(1)' : ''}" alt="">` : ''}</div></div>`
    + `<div style="width:${cm(B.gap)}"></div>`
    + `<div class="p-box" style="width:${cm(B.rightW)};padding:0.1cm ${cm(B.padCm)}">${learning}</div></div>`;
  return h + '</div>';
}

function page2(data, urlOf, photoOf, layout) {
  const gray = (n) => ((data.grayIllusts || []).includes(n) ? ';filter:grayscale(1)' : '');
  let h = '<div class="body">';
  const secs = data.sections || [];
  secs.forEach((sec, si) => {
    const tSize = 18;
    let title = `<span>${esc(sec.title)}</span>`;
    if (sec.titleIllust) {
      const [w, ih] = titleIllustSizeOf(sec);
      const x0 = charWidth(sec.title) * tSize * 0.03528 + 0.9;
      title += `<img class="abs" src="${urlOf(sec.titleIllust)}" style="left:${cm(x0)};top:${cm(0.15 - Math.max(0, ih - 1.2) / 2)};width:${cm(w)};height:${cm(ih)}${gray(sec.titleIllust)}" alt="">`;
    }
    h += `<h2 class="p-title">${title}</h2>`;
    const size = sec.fontSize || 11;
    for (const p of sec.paragraphs || []) h += `<p class="indent" style="font-size:${size}pt">${richText(String(p).replace(/^[\s　]+/, ''))}</p>`;
    const rows = sectionRows(sec, layout.perRow)
      .map((row) => row.filter((it) => (it.photo ? photoOf(it.photo) : true))).filter((row) => row.some((it) => it.photo));
    if (rows.length) {
      h += '<div class="p-photos">';
      for (const row of rows) {
        const laid = layoutSectionRow(row, sec, (it) => (it.photo ? photoOf(it.photo) : sizeOfIllust(it.illust)), layout.scale || 1);
        h += '<div class="p-photo-row">' + laid.map((it) => `<img src="${it.photo ? photoOf(it.photo).url : urlOf(it.illust)}" class="${it.photo ? 'photo' : ''}" style="width:${cm(it.w)};height:${cm(it.h)}" alt="">`).join('') + '</div>';
      }
      h += '</div>';
    }
    if (sec.endIllust) {
      const [w, ih] = endIllustSizeOf(sec);
      h += `<div class="p-end"><img src="${urlOf(sec.endIllust)}" style="width:${cm(w)};height:${cm(ih)}${gray(sec.endIllust)}" alt=""></div>`;
    } else if (si < secs.length - 1 || layout.fill) h += '<p>&nbsp;</p>';
  });
  if (!secs.length && !layout.fill) h += '<p class="p-empty">（2ページ目の記事がまだありません）</p>';
  if (layout.fill) {
    const f = layout.fill;
    h += `<div class="p-fill" style="padding-top:${cm(f.before || 0.21)};text-align:center;line-height:0"><img src="${urlOf(f.name)}" style="width:${cm(f.w)};height:${cm(f.h)}${data.fillGray ? ';filter:grayscale(1)' : ''}" alt=""></div>`;
  }
  return h + '</div>';
}

// イラストの比率（ILLUST_SIZE から）
function sizeOfIllust(name) { const [w, h] = ILLUST_SIZE[name] || [2, 2]; return { width: w * 100, height: h * 100 }; }
