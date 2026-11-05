// 学年だより Word（.docx）作成エンジン
// 11月号を基準にしたテンプレート（書式・フォント・用紙設定）に、毎月の内容を流し込む。
// ブラウザでもNode.jsでも同じように動く。
import { readZip, writeZip, textOf } from './zip.js';
import { imageSize } from './imagesize.js';

// ---- 単位 ----
const EMU_CM = 360000;          // 1cm = 360000 EMU（図形の単位）
const TW_CM = 567;              // 1cm ≒ 567 twip（表・段落の単位）
const emu = (cm) => Math.round(cm * EMU_CM);
const tw = (cm) => Math.round(cm * TW_CM);

// ---- 紙面の寸法（11月号の実測値） ----
export const PAGE = {
  textWidthCm: 18.46,            // A4幅21cm − 左右余白1.27cm×2
  headerBox: { x: 0.088, y: 0.018, w: 18.274, h: 3.283 },
  logo: { x: 1.552, y: 0.282, w: 9.735, h: 2.799 },
  boxes: {                        // 行事予定・学習予定の枠
    indentCm: 0.51, leftW: 8.39, gap: 0.25, rightW: 8.87, heightCm: 11.17,
    padCm: 0.2,
  },
  headEvents: { x: 0.512, y: 0.04, w: 5.345, h: 2.064 },
  headLearning: { x: 9.31, y: 0.375, w: 4.672, h: 1.66 },
  bottomIllust: { w: 5.8, h: 2.14 },
  photoGapCm: 0.35,
  photoMaxHeightCm: 4.6,
};

// 元の11月号での表示サイズ（cm）。イラストはこの大きさを基準にする。
export const ILLUST_SIZE = {
  'kinoko.jpeg': [5.8, 2.14],
  'bears.jpeg': [4.3, 1.68],
  'mascot-ine-small.jpeg': [1.09, 1.2],
  'mascot-ine.jpeg': [1.65, 1.91],
  'mascot-taru.jpeg': [1.76, 2.18],
};

/** 1ページ目「行事予定」の枠の下の絵（tools/make_season_illust.mjs で描いたもの。11月は11月号の元の絵） */
export function boxIllustOf(month) { return Number(month) === 11 ? 'kinoko.jpeg' : `box-${String(month).padStart(2, '0')}.png`; }
/** アプリに最初から入っている小さい絵（見出しの横・記事の終わり用。正方形） */
export function smallIllustsOf(month) { const mm = String(month).padStart(2, '0'); return [`small-${mm}-1.png`, `small-${mm}-2.png`]; }
const BOX_ASPECT = 1296 / 480;
/** 枠の下の絵の大きさ（cm）。11月号のきのこの枠（横5.8×縦2.14cm）に、縦横の比を保って収める */
export function eventsIllustSizeOf(data, name, info) {
  if (data.eventsIllustSize) return data.eventsIllustSize;
  if (ILLUST_SIZE[name]) return ILLUST_SIZE[name];
  const box = { x: 0, y: 0, w: PAGE.bottomIllust.w, h: PAGE.bottomIllust.h };
  const r = /^box-\d\d\.png$/.test(name) ? fitInBox(box, BOX_ASPECT, 1) : info ? fitInBox(box, info.width, info.height) : box;
  return [r.w, r.h];
}
/** 枠の下の絵の名前（data.eventsIllust が null なら絵なし。書いていなければ月の絵） */
export const eventsIllustNameOf = (data) => (data.eventsIllust === undefined ? boxIllustOf(data.month) : data.eventsIllust);

/** 記事の「見出しの横」「記事の終わり」のイラストの大きさ（cm）。先生が取り込んだ絵は sec.titleIllustSize / endIllustSize に入っている */
export const titleIllustSizeOf = (sec) => sec.titleIllustSize || ILLUST_SIZE[sec.titleIllust] || [1.2, 1.2];
export const endIllustSizeOf = (sec) => sec.endIllustSize || ILLUST_SIZE[sec.endIllust] || [2, 2];
/** 白黒にするイラストか（先生が取り込んだ絵。data.grayIllusts に名前が入っている） */
const isGray = (data, name) => (data.grayIllusts || []).includes(name);

const FONT_MARU = 'HG丸ｺﾞｼｯｸM-PRO';
const FONT_POP = 'HGP創英角ﾎﾟｯﾌﾟ体';

// ---- 文字の整形 ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const toZenkaku = (s) => String(s).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
// 文字幅の見積もり（全角=1、半角=0.5）
export const charWidth = (s) => [...String(s)].reduce((n, c) => n + (/[ -~｡-ﾟ]/.test(c) ? 0.5 : 1), 0);

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export function weekdayOf(y, m, d) { return WEEKDAYS[new Date(y, m - 1, d).getDay()]; }

/** 発行日 → 「令和８（２０２６）年１０月３０日（金）」 */
export function formatIssueDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const reiwa = y - 2018;
  return `令和${toZenkaku(reiwa)}（${toZenkaku(y)}）年${toZenkaku(m)}月${toZenkaku(d)}日（${weekdayOf(y, m, d)}）`;
}

/**
 * その月の見出しイラストの名前（「〇月の行事予定」「〇月の学習予定」）。
 * 11月は元の画像、ほかの月は tools/make_heads.mjs で描いた季節の絵。
 */
export function headImagesOf(month) {
  const mm = String(month).padStart(2, '0');
  const ext = Number(month) === 11 ? 'jpeg' : 'png';
  return { events: `head-events-${mm}.${ext}`, learning: `head-learning-${mm}.${ext}` };
}

export function fileNameOf(grade, month) { return `${grade}年生_${month}月_学年だより.docx`; }

// ---- 文字の部品（ラン） ----
function rPr({ font = FONT_MARU, size, bold, underline } = {}) {
  let x = `<w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:hint="eastAsia"/>`;
  if (bold) x += '<w:b/><w:bCs/>';
  if (underline) x += '<w:u w:val="single"/>';
  if (size) x += `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`;
  return `<w:rPr>${x}</w:rPr>`;
}
const run = (text, fmt) => `<w:r>${rPr(fmt)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

// 「__ここ__」で囲んだ部分は下線にする
function richRuns(text, fmt) {
  const parts = String(text).split(/(__.+?__)/g).filter(Boolean);
  return parts.map((p) => (p.startsWith('__') && p.endsWith('__') && p.length > 4
    ? run(p.slice(2, -2), { ...fmt, underline: true }) : run(p, fmt))).join('');
}

function para(inner, { jc, ind, spacing, keepNext, pageBreakBefore, noGrid, fmt } = {}) {
  let p = '';
  if (keepNext) p += '<w:keepNext/>';
  if (pageBreakBefore) p += '<w:pageBreakBefore/>';
  if (noGrid) p += '<w:snapToGrid w:val="0"/>';
  if (spacing) p += spacing;
  if (ind) p += ind;
  if (jc) p += `<w:jc w:val="${jc}"/>`;
  p += rPr(fmt);
  return `<w:p><w:pPr>${p}</w:pPr>${inner}</w:p>`;
}
const emptyPara = (fmt) => para('', { fmt });

// ---- 画像の部品 ----
class Media {
  constructor() { this.items = []; this.nextId = 100; this.byKey = new Map(); }
  add(key, bytes) {
    if (this.byKey.has(key)) return this.byKey.get(key);
    const info = imageSize(bytes);
    const n = this.items.length + 1;
    const ext = info.type === 'png' ? 'png' : 'jpeg';
    const m = { rid: `rIdImg${n}`, target: `media/img${n}.${ext}`, bytes, ...info };
    this.items.push(m); this.byKey.set(key, m);
    return m;
  }
  id() { return this.nextId++; }
}

function picXml(m, cx, cy, id, { grayscale } = {}) {
  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="図 ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rid}" cstate="print">${grayscale ? '<a:grayscl/>' : ''}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
}

function inlineImage(media, m, wCm, hCm, opts) {
  const id = media.id(); const cx = emu(wCm); const cy = emu(hCm);
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="図 ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${picXml(m, cx, cy, id, opts)}</wp:inline></w:drawing></w:r>`;
}

/** 画像（横w×縦h）を、縦横の比を保ったまま枠に収めて、枠のまん中に置く */
export function fitInBox(box, w, h) {
  if (!(w > 0 && h > 0)) return { ...box };
  const k = Math.min(box.w / w, box.h / h);
  const fw = w * k; const fh = h * k;
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

function anchorImage(media, m, box, { relH = 'column', relV = 'paragraph', behind = false, z = 251658300, grayscale = false } = {}) {
  const id = media.id(); const cx = emu(box.w); const cy = emu(box.h);
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${z}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${relH}"><wp:posOffset>${emu(box.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="${relV}"><wp:posOffset>${emu(box.y)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="図 ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>${picXml(m, cx, cy, id, { grayscale })}</wp:anchor></w:drawing></w:r>`;
}

// ---- 1ページ目：ヘッダー（角丸の枠＋ロゴ＋学校名・学年・発行日） ----
// data.logo：ロゴの画像の名前（assets.illust の中）。null ならロゴなし。書いていなければ11月号のロゴ（logo.png）
function headerParagraph(media, data, assets) {
  const logoName = data.logo === undefined ? 'logo.png' : data.logo;
  const logoBytes = logoName && assets.illust[logoName];
  const logo = logoBytes && media.add('illust:' + logoName, logoBytes);
  const b = PAGE.headerBox;
  const id = media.id();
  const line = (text, size, indRight) => `<w:p><w:pPr><w:ind w:right="${indRight}"/><w:jc w:val="right"/>${rPr({ size })}</w:pPr>${text ? run(text, { size }) : ''}</w:p>`;
  const txbx = line('', 11, 210)
    + line(`${data.school}　　　　　`, 11, 210)
    + line(`${toZenkaku(data.grade)}年生　学年だより`, 11, 220)
    + line(formatIssueDate(data.issueDate), 9, 0);
  const shape = `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${emu(b.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(b.y)}</wp:posOffset></wp:positionV><wp:extent cx="${emu(b.w)}" cy="${emu(b.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="角丸四角形 ${id}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 16667"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:round/></a:ln></wps:spPr><wps:txbx><w:txbxContent>${txbx}</w:txbxContent></wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="74295" tIns="8890" rIns="74295" bIns="8890" anchor="t" anchorCtr="0" upright="1"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
  return para((logo ? anchorImage(media, logo, fitInBox(PAGE.logo, logo.width, logo.height), { z: 251658248 }) : '') + shape);
}

// ---- 1ページ目：行事予定・学習予定の枠 ----
const BORDER = 'w:val="dotDash" w:sz="8" w:space="0" w:color="000000"';
function borders(sides) {
  return '<w:tcBorders>' + ['top', 'left', 'bottom', 'right']
    .map((s) => (sides.includes(s) ? `<w:${s} ${BORDER}/>` : `<w:${s} w:val="nil"/>`)).join('') + '</w:tcBorders>';
}

// 1行が枠の幅に収まらないときは、9ptまで文字を小さくする（それでも無理なら折り返す）
export function fitSize(text, indentChars, boxInnerCm, base = 10.5, min = 9) {
  const need = charWidth(text) + indentChars;
  for (let s = base; s >= min; s -= 0.5) {
    if (need * s * 0.03528 <= boxInnerCm * 0.97) return s;
  }
  return base; // 小さくしても入らない長文は、元の大きさのまま折り返す
}

function eventParagraphs(events, innerCm) {
  if (!events.length) return emptyPara();
  return events.map((e) => {
    const day = toZenkaku(e.day);
    const label = `${day.length < 2 ? '　' : ''}${day}日（${e.weekday}）`;
    const size = fitSize(label + e.text, 0, innerCm);
    // 折り返したときは日付の後ろにそろえる
    return para(run(label, { size }) + run(e.text, { size }), {
      jc: 'left', ind: '<w:ind w:left="0" w:hangingChars="0"/>', fmt: { size },
    });
  }).join('');
}

function learningParagraphs(items, innerCm, k = 1) {
  if (!items.length) return emptyPara();
  const out = [];
  const base = LEARN_BASE_PT * k;
  // 小さくするときは、文字と一緒に行の高さも縮める（行グリッドを使わず、行の高さを決める）
  const spacing = k < 1 ? `<w:spacing w:before="0" w:after="0" w:line="${Math.round(360 * k)}" w:lineRule="exact"/>` : undefined;
  for (const it of items) {
    const label = `${it.label}：`;
    const indent = charWidth(label);
    const lines = it.lines.length ? it.lines : [''];
    lines.forEach((line, i) => {
      const size = fitSize(line, indent, innerCm, base, LEARN_MIN_PT * k);
      // 2行目以降は「教科名：」の後ろにそろえる（1行目はぶら下げ）
      const left = Math.round(indent * base * 20);
      const ind = i === 0 ? `<w:ind w:left="${left}" w:hanging="${left}"/>` : `<w:ind w:left="${left}"/>`;
      const labelRun = i === 0 ? run(label, k < 1 ? { size: base } : {}) : '';
      out.push(para(labelRun + run(line, { size }), { jc: 'left', ind, fmt: { size }, spacing, noGrid: k < 1 }));
    });
  }
  return out.join('');
}

function boxesTable(media, data, assets) {
  const B = PAGE.boxes;
  const innerL = B.leftW - B.padCm * 2;
  const innerR = B.rightW - B.padCm * 2;
  const illustKey = eventsIllustNameOf(data);
  const ill = illustKey && assets.illust[illustKey];
  const illRowCm = ill ? PAGE.bottomIllust.h + 0.3 : 0.1;
  const row1H = B.heightCm - illRowCm;
  const tc = (wCm, inner, sides, extra = '') => `<w:tc><w:tcPr><w:tcW w:w="${tw(wCm)}" w:type="dxa"/>${extra}${borders(sides)}</w:tcPr>${inner}</w:tc>`;
  let illXml = emptyPara();
  if (ill) {
    const m = media.add('illust:' + illustKey, ill);
    const [w, h] = eventsIllustSizeOf(data, illustKey, m);
    illXml = para(inlineImage(media, m, w, h, { grayscale: isGray(data, illustKey) }), { jc: 'center', noGrid: true });
  }
  const pad = tw(B.padCm);
  return `<w:tbl><w:tblPr><w:tblW w:w="${tw(B.leftW + B.gap + B.rightW)}" w:type="dxa"/><w:tblInd w:w="${tw(B.indentCm)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="${pad}" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="${pad}" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="${tw(B.leftW)}"/><w:gridCol w:w="${tw(B.gap)}"/><w:gridCol w:w="${tw(B.rightW)}"/></w:tblGrid>`
    + `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(row1H)}" w:hRule="atLeast"/></w:trPr>`
    + tc(B.leftW, eventParagraphs(data.events, innerL), ['top', 'left', 'right'])
    + tc(B.gap, emptyPara(), [])
    + tc(B.rightW, learningParagraphs(data.learning, innerR, learningScaleOf(data)), ['top', 'left', 'right', 'bottom'], '<w:vMerge w:val="restart"/>')
    + '</w:tr>'
    + `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(illRowCm)}" w:hRule="atLeast"/></w:trPr>`
    + tc(B.leftW, illXml, ['left', 'right', 'bottom'], '<w:vAlign w:val="bottom"/>')
    + tc(B.gap, emptyPara(), [])
    + tc(B.rightW, emptyPara(), ['left', 'right', 'bottom'], '<w:vMerge/>')
    + '</w:tr></w:tbl>';
}

// ---- 2ページ目：写真の並べ方 ----
/**
 * 写真の行を決める。各行の写真は同じ高さにそろえ、横幅いっぱいに並べる。
 * row: [{photo:id} | {illust:name}]
 */
export function layoutPhotoRow(row, assetsInfo, { widthCm = PAGE.textWidthCm, gapCm = PAGE.photoGapCm, maxHCm = PAGE.photoMaxHeightCm, scale = 1 } = {}) {
  const items = row.map((it) => ({ ...it, aspect: assetsInfo(it).width / assetsInfo(it).height }));
  const fixedW = items.filter((i) => i.illust).reduce((s, i) => s + (ILLUST_SIZE[i.illust] || [2, 2])[0], 0);
  const photoAspect = items.filter((i) => i.photo).reduce((s, i) => s + i.aspect, 0);
  const free = widthCm - fixedW - gapCm * (items.length - 1);
  const full = photoAspect ? free / photoAspect : 0;   // 横幅いっぱいに並べたときの高さ
  // 大きくするとき（scale>1）も、横幅からははみ出さない
  const h = Math.min(Math.min(full, maxHCm) * scale, full);
  return items.map((i) => {
    if (i.illust) { const [w, ih] = ILLUST_SIZE[i.illust] || [2, 2]; return { ...i, w, h: ih }; }
    return { ...i, w: h * i.aspect, h };
  });
}

function photoRowTable(media, laid, assets, grayscale) {
  const gap = PAGE.photoGapCm;
  const rowH = Math.max(...laid.map((i) => i.h));
  const cols = [];
  laid.forEach((it, i) => { if (i) cols.push({ gap: true, w: gap }); cols.push(it); });
  const cells = cols.map((c) => {
    let inner = emptyPara();
    if (!c.gap) {
      const m = c.photo ? media.add('photo:' + c.photo, assets.photos[c.photo]) : media.add('illust:' + c.illust, assets.illust[c.illust]);
      inner = para(inlineImage(media, m, c.w, c.h, { grayscale: c.photo && grayscale }), { jc: 'center', noGrid: true, spacing: '<w:spacing w:line="240" w:lineRule="auto"/>' });
    }
    return `<w:tc><w:tcPr><w:tcW w:w="${tw(c.w)}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders><w:vAlign w:val="center"/></w:tcPr>${inner}</w:tc>`;
  }).join('');
  const total = cols.reduce((s, c) => s + tw(c.w), 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${tw(c.w)}"/>`).join('')}</w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${tw(rowH)}" w:hRule="exact"/></w:trPr>${cells}</w:tr></w:tbl>`;
}

// 写真の行と行のあいだ（約0.2cmのすきま）
const smallGap = (pt = 6) => `<w:p><w:pPr><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${pt * 20}" w:lineRule="exact"/><w:rPr><w:sz w:val="4"/></w:rPr></w:pPr></w:p>`;

/** 写真を1行最大 perRow 枚で、各行の枚数ができるだけそろうように分ける（例：7枚→3・2・2） */
export function autoRows(photoIds, perRow = 3) {
  const n = photoIds.length;
  if (!n) return [];
  const rowCount = Math.ceil(n / perRow);
  const rows = [];
  let i = 0;
  for (let r = 0; r < rowCount; r++) {
    const size = Math.floor(n / rowCount) + (r < n % rowCount ? 1 : 0);
    rows.push(photoIds.slice(i, i + size).map((p) => ({ photo: p })));
    i += size;
  }
  return rows;
}

// ---- 2ページ目の高さの見積もり（2ページに収めるための計算） ----
export const LINE_CM = 0.635;                 // 1行の高さ（18pt。11月号の行グリッド）
export const PAGE_BODY_HEIGHT_CM = 29.7 - 1.27 * 2;
const ROW_GAP_PT = 6; const PHOTO_TOP_GAP_PT = 4;
const ptToCm = (pt) => pt * 0.03528;

/** 記事の写真の行。sec.perRow（1行の枚数）を先生が決めていれば、それを使う */
export function sectionRows(sec, perRow = 3) {
  return sec.photoRows || (sec.photos && sec.photos.length ? autoRows(sec.photos, sec.perRow || perRow) : []);
}

/**
 * 1行分の写真の大きさ。記事ごとの大きさ（sec.photoSize。1＝ふつう）で並べてから、
 * 2ページに収めるための全体の倍率（fitScale）をかける。
 */
export function layoutSectionRow(row, sec, info, fitScale = 1) {
  const laid = layoutPhotoRow(row, info, { scale: sec.photoSize || 1 });
  return laid.map((i) => (i.photo ? { ...i, w: i.w * fitScale, h: i.h * fitScale } : i));
}

/**
 * 写真が多いときは、1行に並べる枚数を増やして2ページ目に収める。
 * 3枚→4枚→5枚→6枚の順に試し、写真をできるだけ大きく保てる並べ方を選ぶ。
 */
export function choosePhotoLayout(sections, photoAspectOf, illustAspectOf) {
  let best = null;
  for (let perRow = 3; perRow <= 6; perRow++) {
    const secs = sections.map((s) => ({ ...s, _perRow: perRow }));
    const fit = fitPhotoScale(secs, photoAspectOf, illustAspectOf);
    const r = { perRow, ...fit };
    if (fit.fits && fit.scale >= 0.9) return r;
    if (!best || (fit.fits && !best.fits) || (fit.fits === best.fits && fit.scale > best.scale)) best = r;
  }
  return best;
}

// ---- 1ページ目の高さの見積もり ----
function wrappedLines(text, indentChars, sizePt, innerCm) {
  const size = fitSize(text, indentChars, innerCm, sizePt, sizePt * LEARN_MIN_PT / LEARN_BASE_PT);
  const perLine = innerCm * 0.97 / ptToCm(size);
  return Math.max(1, Math.ceil((charWidth(text) + indentChars) / perLine));
}
// 学習予定の文字の大きさ（ふつう10.5pt）。1ページ目からはみ出すときだけ、この割合まで自動で小さくする
const LEARN_BASE_PT = 10.5; const LEARN_MIN_PT = 9;
export const LEARN_MIN_SCALE = 0.8;
const LEARN_SCALES = [1, 0.95, 0.9, 0.85, LEARN_MIN_SCALE];

/**
 * 学習予定の文字の大きさの割合（1＝ふつう）。1ページ目に収まる、いちばん大きい割合を選ぶ。
 * 小さくしても収まらないときは、はみ出しがいちばん少なくなる割合（小さくしても変わらなければ1）。
 * 内容が変わるたびに計算し直すので、項目を減らすと、自動で元の大きさに戻る。
 */
export function learningScaleOf(data) {
  let best = null;
  for (const k of LEARN_SCALES) {
    const m = measurePage1At(data, k);
    if (m.fits) return k;
    if (!best || m.used < best.used - 0.01) best = { k, used: m.used };
  }
  return best.k;
}
export function measurePage1(data) {
  const k = learningScaleOf(data);
  return { ...measurePage1At(data, k), learningScale: k };
}
function measurePage1At(data, k) {
  const B = PAGE.boxes;
  const greet = (data.greeting || []).reduce((n, g) => n + textLines(String(g).replace(/^[\s　]+/, ''), 10.5), 0);
  const evLines = (data.events || []).reduce((n, e) => n + wrappedLines(`${toZenkaku(e.day).length < 2 ? '　' : ''}${toZenkaku(e.day)}日（${e.weekday}）${e.text}`, 0, 10.5, B.leftW - B.padCm * 2), 0);
  const lnLines = (data.learning || []).reduce((n, it) => n + (it.lines.length ? it.lines : ['']).reduce((m, l) => m + wrappedLines(l, charWidth(it.label + '：'), LEARN_BASE_PT * k, B.rightW - B.padCm * 2), 0), 0);
  const illRow = PAGE.bottomIllust.h + 0.3;
  const pad = 0.2;
  const boxH = Math.max(B.heightCm, evLines * LINE_CM + illRow + pad, lnLines * LINE_CM * k + pad);
  const used = 6 * LINE_CM + greet * LINE_CM + 4 * LINE_CM + boxH;
  return { used, limit: PAGE_BODY_HEIGHT_CM, fits: used <= PAGE_BODY_HEIGHT_CM - 0.3, eventLines: evLines, learningLines: lnLines, greetingLines: greet };
}
function textLines(text, sizePt, widthCm = PAGE.textWidthCm) {
  const perLine = Math.floor(widthCm / ptToCm(sizePt));
  return Math.max(1, Math.ceil((charWidth(String(text).replace(/__/g, '')) + 1) / perLine));
}

/** 2ページ目の各部分の高さ（cm）。fixed = 文字など、photo = 写真の高さの合計 */
export function measurePage2(sections, photoAspectOf, illustAspectOf) {
  let fixed = 0; let photo = 0;
  sections.forEach((sec, si) => {
    fixed += LINE_CM * 2;                                     // 見出し（18pt＝2行分）
    const size = sec.fontSize || 11;
    for (const p of sec.paragraphs || []) fixed += textLines(p, size) * LINE_CM;
    const rows = sectionRows(sec, sec._perRow);
    if (rows.length) {
      fixed += ptToCm(PHOTO_TOP_GAP_PT) + ptToCm(ROW_GAP_PT) * (rows.length - 1);
      for (const row of rows) {
        const laid = layoutSectionRow(row, sec, (it) => (it.photo ? photoAspectOf(it.photo) : illustAspectOf(it.illust)));
        const ph = Math.max(...laid.filter((i) => i.photo).map((i) => i.h), 0);
        const ih = Math.max(...laid.filter((i) => i.illust).map((i) => i.h), 0);
        photo += ph; if (ih > ph) fixed += ih - ph;
      }
    }
    const last = si === sections.length - 1;
    if (sec.endIllust) fixed += endIllustSizeOf(sec)[1] + 0.1;
    else if (!last) fixed += LINE_CM;                          // 記事と記事のあいだの1行
  });
  return { fixed, photo };
}

/** 2ページ目に収まるように写真の大きさの倍率を決める */
export function fitPhotoScale(sections, photoAspectOf, illustAspectOf, { safetyCm = 0.8, minScale = 0.6 } = {}) {
  const { fixed, photo } = measurePage2(sections, photoAspectOf, illustAspectOf);
  const room = PAGE_BODY_HEIGHT_CM - safetyCm - fixed;
  if (photo === 0) return { scale: 1, fits: fixed <= PAGE_BODY_HEIGHT_CM - safetyCm, fixed, photo };
  const scale = Math.min(1, room / photo);
  return { scale: Math.max(scale, minScale), fits: scale >= minScale, fixed, photo };
}

/** その月の「下の空き」用の季節のイラスト（tools/make_heads.mjs で作ったもの。横:縦＝16:9） */
export function seasonIllustOf(month) { return `season-${String(month).padStart(2, '0')}.png`; }
export const SEASON_ASPECT = 960 / 540;
const FILL_MIN_ROOM_CM = 3.5;   // これより空きが少ないときは置かない
const FILL_MAX_H_CM = 6;        // 置くときの高さの上限

/**
 * 2ページ目の下が大きく空くとき、季節のイラストを置く大きさを決める。
 * 先生が取り込んだ画像（data.fillIllust）のときは、その画像の縦横の比（data.fillAspect＝横÷縦）に合わせる。
 * @param fit choosePhotoLayout の結果  @returns { name, w, h, before } または null
 */
export function fillIllustOf(data, fit, aspect = data.fillAspect || SEASON_ASPECT) {
  if (data.autoFill === false) return null;
  const room = PAGE_BODY_HEIGHT_CM - 0.8 - fit.fixed - fit.photo * (fit.scale || 1);
  if (room < FILL_MIN_ROOM_CM) return null;
  let h = Math.min(room - 0.9, FILL_MAX_H_CM);
  let w = h * aspect;
  if (w > PAGE.textWidthCm) { w = PAGE.textWidthCm; h = w / aspect; }
  // 空いたところの上下まん中に置く（記事のあとの1行分を引いて計算）
  const before = Math.max(0.21, (room - LINE_CM - h) / 2);
  return { name: data.fillIllust || seasonIllustOf(data.month), w, h, before };
}

function sectionXml(media, sec, assets, opts, first, last) {
  let x = '';
  const titleSize = 18;
  let title = run(sec.title, { font: FONT_POP, size: titleSize, bold: true });
  if (sec.titleIllust && assets.illust[sec.titleIllust]) {
    // 見出しの右横に浮かせて置く（行の高さを変えない）
    const m = media.add('illust:' + sec.titleIllust, assets.illust[sec.titleIllust]);
    const [w, h] = titleIllustSizeOf(sec);
    const x0 = charWidth(sec.title) * ptToCm(titleSize) + 0.9;
    // 高さ1.2cmより大きい絵は、見出しの行のまん中にそろうように少し上げる
    title += anchorImage(media, m, { x: x0, y: -0.15 - Math.max(0, h - 1.2) / 2, w, h }, { grayscale: opts.grayscale !== false && isGray(opts.data, sec.titleIllust) });
  }
  x += para(title, { jc: 'left', keepNext: true, pageBreakBefore: first, fmt: { font: FONT_POP, size: titleSize, bold: true } });
  const size = sec.fontSize || 11;
  for (const p of sec.paragraphs || []) {
    const text = String(p).replace(/^[\s　]+/, '');
    x += para(richRuns(text, { size }), { ind: '<w:ind w:firstLineChars="100" w:firstLine="' + Math.round(size * 20) + '"/>', fmt: { size } });
  }
  const rows = sectionRows(sec, sec._perRow);
  if (rows.length) {
    x += smallGap(PHOTO_TOP_GAP_PT);
    rows.forEach((row, i) => {
      if (i) x += smallGap(ROW_GAP_PT);
      const laid = layoutSectionRow(row, sec, (it) => (it.photo ? opts.photoInfo(it.photo) : opts.illustInfo(it.illust)), opts.photoScale || 1);
      x += photoRowTable(media, laid, assets, opts.grayscale !== false);
    });
  }
  if (sec.endIllust && assets.illust[sec.endIllust]) {
    const m = media.add('illust:' + sec.endIllust, assets.illust[sec.endIllust]);
    const [w, h] = endIllustSizeOf(sec);
    x += para(inlineImage(media, m, w, h, { grayscale: opts.grayscale !== false && isGray(opts.data, sec.endIllust) }), { jc: 'right', noGrid: true, ind: `<w:ind w:right="${tw(0.5)}"/>` });
  } else if (last) {
    x += smallGap(1);        // 最後は極小の段落にして、3ページ目ができないようにする
  } else {
    x += emptyPara();
  }
  return x;
}

// ---- 全体の組み立て ----
/**
 * @param data   学年だよりの内容（JSON）
 * @param assets { template: Uint8Array, illust: {名前: Uint8Array}, photos: {id: Uint8Array} }
 * @param opts   { grayscale: true, photoScale: 1 }
 * @returns Uint8Array（.docx）
 */
export async function buildDocx(data, assets, opts = {}) {
  const tpl = await readZip(assets.template);
  const media = new Media();
  const sizeCache = new Map();
  const info = (key, bytes) => { if (!sizeCache.has(key)) sizeCache.set(key, imageSize(bytes)); return sizeCache.get(key); };
  const o = {
    ...opts,
    data,
    photoInfo: (id) => info('p' + id, assets.photos[id]),
    illustInfo: (n) => info('i' + n, assets.illust[n]),
  };

  let body = '';
  // 1ページ目
  body += headerParagraph(media, data, assets);
  for (let i = 0; i < 5; i++) body += emptyPara();
  for (const g of data.greeting || []) {
    body += para(run(String(g).replace(/^[\s　]+/, '')), { ind: '<w:ind w:firstLineChars="100" w:firstLine="210"/>' });
  }
  body += emptyPara();
  const heads = [];
  // 見出しイラストは、指定がなければ月の数字から自動で選ぶ
  const auto = headImagesOf(data.month);
  const heName = data.headEventsImage || auto.events; const hlName = data.headLearningImage || auto.learning;
  const he = assets.illust[heName]; const hl = assets.illust[hlName];
  if (he) heads.push(anchorImage(media, media.add('illust:' + heName, he), PAGE.headEvents, { z: 251658250 }));
  if (hl) heads.push(anchorImage(media, media.add('illust:' + hlName, hl), PAGE.headLearning, { z: 251658251 }));
  body += para(heads.join(''), { fmt: { size: 12 } });
  body += emptyPara() + emptyPara();
  body += boxesTable(media, data, assets);
  // 2ページ目（写真の大きさは、2ページ目に収まるよう自動で決める）
  const fit = choosePhotoLayout(data.sections || [], (id) => o.photoInfo(id), (n) => o.illustInfo(n));
  const secs = (data.sections || []).map((s) => ({ ...s, _perRow: fit.perRow }));
  if (!opts.photoScale) o.photoScale = fit.scale;
  // 下の空きのイラスト：縦横の比は、実際の画像から決める
  const fillName = data.fillIllust || seasonIllustOf(data.month);
  const fillInfo = assets.illust[fillName] && o.illustInfo(fillName);
  const fill = fillIllustOf(data, { ...fit, scale: o.photoScale }, fillInfo && fillInfo.width && fillInfo.height ? fillInfo.width / fillInfo.height : undefined);
  const fillBytes = fill && assets.illust[fill.name];
  if (opts.onReport) opts.onReport({ ...fit, usedScale: o.photoScale, page1: measurePage1(data), fill: fillBytes ? fill : null });
  secs.forEach((sec, i) => { body += sectionXml(media, sec, assets, o, i === 0, i === secs.length - 1 && !fillBytes); });
  if (fillBytes) {
    // 下の空きに季節のイラスト（2ページ目の最後。改ページは最初の記事の見出しに付いている）
    const m = media.add('illust:' + fill.name, fillBytes);
    body += para(inlineImage(media, m, fill.w, fill.h, { grayscale: !!data.fillGray && opts.grayscale !== false }), { jc: 'center', noGrid: true, pageBreakBefore: !secs.length, spacing: `<w:spacing w:before="${tw(fill.before)}" w:after="0" w:line="240" w:lineRule="auto"/>` });
    body += smallGap(1);
  }
  if (!secs.length && !fillBytes) body += emptyPara();

  const docXml = textOf(tpl['word/document.xml']).replace('<!--BODY-->', body);

  const out = { ...tpl };
  out['word/document.xml'] = docXml;
  for (const m of media.items) out['word/' + m.target] = m.bytes;
  out['word/_rels/document.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + [['styles', 'styles.xml'], ['settings', 'settings.xml'], ['webSettings', 'webSettings.xml'], ['fontTable', 'fontTable.xml'],
      ['theme', 'theme/theme1.xml'], ['footnotes', 'footnotes.xml'], ['endnotes', 'endnotes.xml'], ['numbering', 'numbering.xml']]
      .map(([t, f], i) => `<Relationship Id="rIdB${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}" Target="${f}"/>`).join('')
    + media.items.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.target}"/>`).join('')
    + '</Relationships>';
  out['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  out['docProps/core.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(`${data.grade}年生 ${data.month}月 学年だより`)}</dc:title><dc:creator></dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const W = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  out['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>'
    + `<Override PartName="/word/document.xml" ContentType="${W}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${W}.styles+xml"/><Override PartName="/word/settings.xml" ContentType="${W}.settings+xml"/><Override PartName="/word/webSettings.xml" ContentType="${W}.webSettings+xml"/><Override PartName="/word/fontTable.xml" ContentType="${W}.fontTable+xml"/><Override PartName="/word/footnotes.xml" ContentType="${W}.footnotes+xml"/><Override PartName="/word/endnotes.xml" ContentType="${W}.endnotes+xml"/><Override PartName="/word/numbering.xml" ContentType="${W}.numbering+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const order = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', ...Object.keys(out).filter((k) => !['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].includes(k))];
  return writeZip(out, order);
}
