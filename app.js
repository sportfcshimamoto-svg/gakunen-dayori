// 学年だより作成アプリ：画面の動き
// すべてこのブラウザの中で処理する（ファイルや写真をインターネットに送らない）。
import {
  buildDocx, fileNameOf, measurePage1, choosePhotoLayout, weekdayOf, ILLUST_SIZE, LINE_CM, PAGE_BODY_HEIGHT_CM, headImagesOf,
  fillIllustOf, seasonIllustOf, boxIllustOf, smallIllustsOf, fitInBox, PAGE, SEASON_ASPECT,
} from './lib/docx-builder.js';
import { extractEvents, toNewsletterEvents } from './lib/events.js';
import { renderPreview } from './lib/preview.js';
import { placeIllusts } from './lib/illust-place.js';
import { extractCurriculum, SCHOOL_MONTHS } from './lib/curriculum.js';
import { isPdf, extractCurriculumPdf } from './lib/curriculum-pdf.js';   // PDFを読む部品（大きい）は、PDFを選んだときだけ読み込む
import { greetingPrompt, sectionPrompt, cleanAiText, looksLikeNames, SECTION_KINDS } from './lib/ai-prompt.js';
import { precheck } from './lib/precheck.js';
import {
  preparePhoto, putPhoto, getPhoto, deletePhoto, allPhotos, isPersistent, blobToBase64, base64ToBlob,
} from './lib/photo-store.js';

const STORE_KEY = 'gakunen-dayori:v1';
const ILLUST_DIR = 'assets/illust/';
const BASE_ILLUST = ['logo.png', 'kinoko.jpeg', 'bears.jpeg', 'mascot-ine-small.jpeg', 'mascot-ine.jpeg', 'mascot-taru.jpeg'];
const SUBJECTS = ['国語', '社会', '算数', '理科', '音楽', '図工', '家庭', '体育', '外国語', '道徳', '総合'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 状態 ----------
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function newState() {
  const now = new Date();
  return {
    version: 1,
    data: {
      school: '', grade: 5, month: (now.getMonth() + 1) % 12 + 1, issueDate: today(),
      greeting: [],
      learning: SUBJECTS.map((label) => ({ label, lines: [] })),
      sections: [],
    },
    eventDays: [],           // 行事のチェック画面の中身（日ごとの行事と、載せる／載せない）
    eventsFor: null,         // eventDays がどの学年・月のものか
    xlsxName: '',
  };
}
let state = load() || newState();
let xlsxBytes = null;        // 読み込んだExcel（保存はしない。学年や月を変えたときの読み直しに使う）
let tab = 'basic';
let showExcluded = true;

function load() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); return s && s.data ? s : null; } catch { return null; }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { toast('ブラウザに保存できませんでした。「保存ファイルに書き出す」で保存してください。'); } }, 300);
}
function changed() { save(); schedulePreview(); }

/** 発行日から、その月の年を決める（12月発行の1月号なら翌年） */
function yearOfMonth(month) {
  const [y, m] = (state.data.issueDate || today()).split('-').map(Number);
  if (month < m - 6) return y + 1;
  if (month > m + 6) return y - 1;
  return y;
}

/** Wordやプレビューに渡す形にする */
function newsletterData() {
  const d = structuredClone(state.data);
  d.events = toNewsletterEvents({ days: state.eventDays });
  // 写真：このブラウザに保存されていて、「使う」になっている写真だけを、並べた順に載せる
  d.sections = (d.sections || []).map((s) => {
    const t = { ...s };
    delete t.photoRows; delete t.photoOff;
    t.photos = (s.photos || []).filter((id) => photoMeta.has(id) && !(s.photoOff || []).includes(id));
    return t;
  });
  // ロゴ：学年ごとに取り込んだもの（なければ最初から入っているもの。それもなければロゴなし）
  d.logo = logoOf(d.grade);
  // 季節のイラスト：その月に取り込んだ絵があれば、1枚を下の空きに大きく、残りを小さく空いているところに置く（白黒）
  lastPlacement = placeSeason(d);
  return d;
}
let lastPlacement = { fill: null, spots: [] };   // 画面に「どの絵をどこに置いたか」を出すため
function placeSeason(d) {
  // 1ページ目の行事予定の枠の下の絵（d.boxChoice：未指定＝その月の絵、'none'＝なし、または取り込んだ絵のID）
  const own = seasonPool(d.month);
  const bc = d.boxChoice;
  if (bc === 'none') d.eventsIllust = null;
  else if (bc && own.includes(bc)) {
    const m = illustMeta.get(bc);
    const r = fitInBox({ x: 0, y: 0, w: PAGE.bottomIllust.w, h: PAGE.bottomIllust.h }, m.width, m.height);
    d.eventsIllust = bc; d.eventsIllustSize = [r.w, r.h];
  } else d.eventsIllust = boxIllustOf(d.month);
  // 2ページ目：取り込んだ絵（枠の下に使った絵はのぞく）と、最初から入っている絵
  const pool = own.filter((id) => id !== d.eventsIllust).map((id) => { const m = illustMeta.get(id); return { id, aspect: m.width / m.height }; });
  pool.push({ id: seasonIllustOf(d.month), aspect: SEASON_ASPECT, builtin: 'fill' });
  for (const id of smallIllustsOf(d.month)) pool.push({ id, aspect: 1, builtin: 'small' });
  const r = placeIllusts(d, pool, { photoAspectOf: (id) => photoMeta.get(id), illustAspectOf: (n) => illustSize(n) });
  if (own.includes(d.eventsIllust)) d.grayIllusts.push(d.eventsIllust);
  r.box = d.eventsIllust;
  return r;
}
/** 画面での絵の呼び名 */
function illLabel(m, id) {
  const n = seasonPool(m).indexOf(id);
  if (n >= 0) return `${n + 1}の絵`;
  const k = smallIllustsOf(m).indexOf(id);
  if (k >= 0) return `最初からある小さい絵${k ? 'イ' : 'ア'}`;
  return '最初からある大きい絵';
}

// ---------- 写真 ----------
const photoMeta = new Map();   // 写真ID → { width, height, url, name }
function addMeta(rec) {
  const old = photoMeta.get(rec.id); if (old) URL.revokeObjectURL(old.url);
  photoMeta.set(rec.id, { width: rec.width, height: rec.height, name: rec.name, url: URL.createObjectURL(rec.blob) });
}
async function loadPhotoMeta() {
  try { for (const rec of await allPhotos()) (rec.kind ? addIllustMeta : addMeta)(rec); } catch { /* 写真なしで続ける */ }
  if (!(await isPersistent())) toast('このブラウザでは写真を保存できません。ページを閉じると写真が消えます。');
}
async function removePhotos(ids) {
  for (const id of ids) {
    try { await deletePhoto(id); } catch { /* 消せなくても続ける */ }
    const m = photoMeta.get(id); if (m) URL.revokeObjectURL(m.url); photoMeta.delete(id);
  }
}
// ---------- 写真の自動削除（毎月1日） ----------
// 新しい月になって最初にアプリを開いたとき、前の月までに入れた写真を、このブラウザから消す。
// 消すのは記事の写真だけ（ロゴ・季節のイラストは消さない）。保存ファイルに書き出した写真は消えない。
const CLEAN_KEY = STORE_KEY + ':photoCleanMonth';
async function monthlyPhotoCleanup(now = new Date()) {
  const ym = `${now.getFullYear()}-${now.getMonth() + 1}`;
  let last = null; try { last = localStorage.getItem(CLEAN_KEY); } catch { /* なし */ }
  if (last === ym) return;
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let old;
  try { old = (await allPhotos()).filter((r) => !r.kind && (r.addedAt || 0) < start).map((r) => r.id); } catch { return; }
  if (old.length) {
    await removePhotos(old);
    const gone = new Set(old);
    for (const sec of state.data.sections || []) {
      sec.photos = (sec.photos || []).filter((id) => !gone.has(id));
      if (sec.photoOff) sec.photoOff = sec.photoOff.filter((id) => !gone.has(id));
    }
    save();
    toast(`${now.getMonth() + 1}月になったので、前の月までに入れた写真（${old.length}枚）を、このブラウザから消しました`);
  }
  try { localStorage.setItem(CLEAN_KEY, ym); } catch { /* 覚えられなくても、次に開いたときにもう一度調べるだけ */ }
}
async function addPhotos(si, files) {
  const sec = state.data.sections[si]; if (!sec) return;
  sec.photos = sec.photos || [];
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|hei[cf])$/i.test(f.name));
  if (!list.length) { toast('写真のファイル（JPEGかPNG）を選んでください'); return; }
  let n = 0;
  for (const f of list) {
    try {
      const rec = await preparePhoto(f);
      await putPhoto(rec); addMeta(rec); sec.photos.push(rec.id); n++;
    } catch (e) { toast(e.message || String(e)); }
  }
  if (n) toast(`写真を${n}枚入れました`);
  changed(); renderPanel();
}
const allPhotoIds = () => state.data.sections.flatMap((s) => s.photos || []);

// ---------- 先生が取り込んだ季節のイラストと、学年ごとのロゴ ----------
// 毎年・毎月使うので、記事の写真とは別に扱う（「新しく作り直す」でも消えない）。保存場所は写真と同じブラウザの中。
// 季節のイラストは、月ごとに何枚でも登録できる（ID：user-season-11-xxxxx。前の形の user-season-11 も11月の絵として使う）
const illustMeta = new Map();   // 'user-season-11-xxxxx' / 'user-logo-g5' → { width, height, name, url, type, addedAt }
const SEASON_ID = /^user-season-(\d\d)(-\w+)?$/;
const newSeasonId = (m) => `user-season-${String(m).padStart(2, '0')}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const monthOfIllust = (id) => { const r = SEASON_ID.exec(id); return r ? Number(r[1]) : 0; };
/** その月に取り込んだ絵のID（取り込んだ順） */
const seasonPool = (m) => [...illustMeta.keys()].filter((id) => monthOfIllust(id) === Number(m))
  .sort((a, b) => (illustMeta.get(a).addedAt || 0) - (illustMeta.get(b).addedAt || 0));
const logoKey = (g) => `user-logo-g${g}`;
const DEFAULT_LOGO = { 5: 'logo.png' };   // 最初から入っているロゴ（5年生の ONETEAM）。ほかの学年は、取り込むまでロゴなし
function addIllustMeta(rec) {
  const old = illustMeta.get(rec.id); if (old) URL.revokeObjectURL(old.url);
  illustMeta.set(rec.id, { width: rec.width, height: rec.height, name: rec.name, type: rec.type, addedAt: rec.addedAt || 0, url: URL.createObjectURL(rec.blob) });
}
const urlOf = (n) => (illustMeta.has(n) ? illustMeta.get(n).url : ILLUST_DIR + n);
const logoOf = (grade) => (illustMeta.has(logoKey(grade)) ? logoKey(grade) : DEFAULT_LOGO[grade] || null);
async function setIllust(key, kind, file) {
  if (!file) return false;
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|hei[cf])$/i.test(file.name)) { toast('画像のファイル（JPEGかPNG）を選んでください'); return false; }
  try {
    const rec = await preparePhoto(file, { keepPng: true, id: key });
    rec.kind = kind;
    await putPhoto(rec); addIllustMeta(rec);
    return true;
  } catch (e) { toast(e.message || String(e)); return false; }
}
async function removeIllust(key) {
  try { await deletePhoto(key); } catch { /* 消せなくても続ける */ }
  const m = illustMeta.get(key); if (m) URL.revokeObjectURL(m.url); illustMeta.delete(key);
}

// ---------- タブ ----------
const TABS = [
  ['basic', '① 基本'], ['events', '② 行事予定'], ['learning', '③ 学習予定'], ['greeting', '④ あいさつ'], ['page2', '⑤ 2ページ目'],
  ['curriculum', '⑥ カリキュラム'],
];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, label]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${label}</button>`).join('');
}
$('#tabs').addEventListener('click', (e) => { const k = e.target.dataset.tab; if (k) { tab = k; renderTabs(); renderPanel(); } });

function renderPanel() {
  const p = $('#panel');
  p.innerHTML = ({ basic: panelBasic, events: panelEvents, learning: panelLearning, greeting: panelGreeting, page2: panelPage2, curriculum: panelCurriculum })[tab]();
}

// ---------- ① 基本 ----------
function panelBasic() {
  const d = state.data;
  const opt = (n, v, unit) => `<option value="${n}" ${n === v ? 'selected' : ''}>${n}${unit}</option>`;
  return `<h2>基本の設定</h2>
  <div class="field"><label for="f-school">学校名</label><input id="f-school" type="text" data-bind="school" value="${esc(d.school)}" placeholder="例：〇〇市立〇〇小学校"></div>
  <div class="field"><label for="f-grade">学年</label><select id="f-grade" data-bind="grade" data-num="1">${[1, 2, 3, 4, 5, 6].map((n) => opt(n, d.grade, '年生')).join('')}</select></div>
  <div class="field"><label for="f-month">何月号</label><select id="f-month" data-bind="month" data-num="1">${[4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((n) => opt(n, d.month, '月号')).join('')}</select></div>
  <div class="field"><label for="f-date">発行日</label><input id="f-date" type="date" data-bind="issueDate" value="${esc(d.issueDate)}"></div>
  ${logoField(d.grade)}
  <p class="help">入力した内容は、このブラウザに自動で保存されます。別のパソコンで続きをするときは、上の「保存ファイルに書き出す」を使ってください。</p>`;
}

function logoField(grade) {
  const logo = logoOf(grade);
  const custom = illustMeta.has(logoKey(grade));
  return `<div class="field" style="align-items:start"><label>ロゴ（${grade}年生）</label><div>
    <div class="ill-set"><div class="ill-box logo-box" data-ill-drop="logo">${logo ? `<img src="${urlOf(logo)}" alt="${grade}年生のロゴ">` : '<span>ロゴなし</span>'}</div>
    <div class="ill-btns"><label class="btn small">画像を選ぶ<input type="file" accept="image/png,image/jpeg" data-ill-add="logo" hidden></label>
    ${custom ? `<button class="small" data-ill-del="logo">${DEFAULT_LOGO[grade] ? '最初のロゴに戻す' : 'ロゴを外す'}</button>` : ''}</div></div>
    ${logo ? '' : '<div class="notice warn">この学年のロゴは、まだ設定されていません（ロゴなしで作ります）。</div>'}
    <p class="help" style="margin:4px 0 0">ロゴは学年ごとに、このブラウザに保存されます（毎月そのまま使えます）。1ページ目の左上の枠（横9.7cm×縦2.8cm）に、縦横の比を保って収めます。</p></div></div>`;
}

// ---------- ② 行事予定 ----------
function panelEvents() {
  const d = state.data;
  let h = `<h2>${d.month}月の行事予定（${d.grade}年生）</h2>
  <div class="adder"><label class="btn">年間行事予定（Excel）を選ぶ<input id="f-xlsx" type="file" accept=".xlsx" hidden></label>
  <span class="help" style="margin:0">${state.xlsxName ? `読み込んだファイル：${esc(state.xlsxName)}` : 'まだ読み込んでいません'}</span></div>
  <div class="card sheet-card"><div class="card-head"><b>Googleスプレッドシートから読み込む</b></div>
    <div class="adder" style="margin:6px 0 0"><input id="f-sheet" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(sheetUrl)}" style="flex:1;min-width:12em">
    <button id="btn-sheet">スプレッドシートから読み込む</button></div>
    <p class="help" style="margin:6px 0 0">共有のリンクを貼ってください。リンクはこのブラウザが覚えるので、次からはボタンを押すだけで最新の行事予定を読み込めます。共有の設定を「リンクを知っている全員」にしてください。</p></div>
  <p class="help">チェックが付いている行事が学年だよりに載ります。文字はその場で直せます。灰色の行事は、自動で「載せない」にしたものです（理由を下に書いています）。</p>`;
  const ef = state.eventsFor;
  if (ef && (ef.grade !== d.grade || ef.month !== d.month)) {
    h += `<div class="notice warn">この一覧は ${ef.grade}年生・${ef.month}月 の行事です。${xlsxBytes ? '' : sheetUrl ? '「スプレッドシートから読み込む」を押すか、Excelをもう一度選ぶと、' : 'Excelをもう一度選ぶと、'}${d.grade}年生・${d.month}月 の行事に読み直せます。${xlsxBytes ? '<button id="btn-reextract" class="small">読み直す</button>' : ''}</div>`;
  }
  for (const w of state.extractWarnings || []) h += `<div class="notice warn">⚠ ${esc(w)}</div>`;
  const total = state.eventDays.reduce((n, day) => n + day.items.filter((i) => i.include).length, 0);
  h += `<div class="adder"><label><input id="f-showex" type="checkbox" ${showExcluded ? 'checked' : ''}> 載せない行事も表示する</label><span class="help" style="margin:0">載せる行事：${total}件</span></div>`;
  state.eventDays.forEach((day, di) => {
    const items = day.items.map((it, ii) => ({ it, ii })).filter(({ it }) => showExcluded || it.include);
    if (!items.length) return;
    h += `<div class="day"><div class="day-label">${day.day}日（${esc(day.weekday)}）</div><div>`;
    for (const { it, ii } of items) {
      h += `<div class="item ${it.include ? '' : 'off'}">
        <input type="checkbox" data-ev="include" data-d="${di}" data-i="${ii}" ${it.include ? 'checked' : ''} title="載せる">
        <input type="text" data-ev="text" data-d="${di}" data-i="${ii}" value="${esc(it.text)}">
        <button class="small" data-ev="del" data-d="${di}" data-i="${ii}" title="この行事を消す">×</button>
        ${it.raw && it.raw !== it.text || it.reason ? `<div class="item-note">${it.raw ? `元：「${esc(it.raw)}」　` : ''}${esc(it.reason || '')}</div>` : ''}
        ${it.warn ? `<div class="item-warn">⚠ ${esc(it.warn)}</div>` : ''}</div>`;
    }
    h += `<button class="small" data-ev="addItem" data-d="${di}">＋ この日に行事を足す</button></div></div>`;
  });
  if (!state.eventDays.length) h += '<p class="help">Excelを選ぶか、スプレッドシートから読み込むか、下から日にちを足してください。</p>';
  h += `<div class="adder">日にち <input id="f-newday" type="number" min="1" max="31" style="width:5em"> 日 <button id="btn-addday">行事を足す</button></div>`;
  return h + boxIllustField();
}

/** 1ページ目の行事予定の枠の下の絵を選ぶ（その月の絵／取り込んだ絵／なし） */
function boxIllustField() {
  const d = state.data; const m = d.month;
  newsletterData();   // lastPlacement.box を最新にする
  const own = seasonPool(m);
  const v = d.boxChoice === 'none' || own.includes(d.boxChoice) ? d.boxChoice : '';
  const o = (val, label) => `<option value="${val}" ${v === val ? 'selected' : ''}>${label}</option>`;
  const cur = lastPlacement.box;
  return `<div class="card" style="margin-top:14px"><div class="card-head"><b>行事予定の枠の下の絵</b></div>
    <div class="ill-set"><div class="ill-box box-box">${cur ? `<img src="${urlOf(cur)}" class="${own.includes(cur) ? 'gray' : ''}" alt="">` : '<span>絵なし</span>'}</div>
    <label>絵 <select id="f-boxchoice">${o('', `${m}月の絵（最初からある絵）`)}${own.map((id) => o(id, `取り込んだ${illLabel(m, id)}`)).join('')}${o('none', 'なし')}</select></label></div>
    <p class="help" style="margin:6px 0 0">${m === 11 ? '11月は、11月号のきのこの絵です。' : ''}取り込んだ絵（⑤2ページ目の「季節のイラスト」で入れた絵）からも選べます。選んだ絵は2ページ目には使いません。</p></div>`;
}

// ---------- Googleスプレッドシート（共有リンク）から行事予定を読む ----------
// リンクはこのブラウザにだけ覚える（アプリの中や保存ファイルには入れない）。
// 中身は毎回Googleから Excel の形でダウンロードして、Excelを選んだときと同じように読む。
let sheetUrl = (() => { try { return localStorage.getItem(STORE_KEY + ':sheet') || ''; } catch { return ''; } })();
const sheetIdOf = (url) => { const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : null; };
async function loadSheet(url) {
  const id = sheetIdOf(url);
  if (!id) { toast('Googleスプレッドシートのリンクではないようです。共有のリンク（https://docs.google.com/spreadsheets/d/…）を貼ってください'); return; }
  toast('スプレッドシートを読み込んでいます…');
  let bytes;
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('not xlsx');   // Excelの形（PK）でなければ失敗
  } catch {
    toast('スプレッドシートを読み込めませんでした。共有の設定が「リンクを知っている全員」になっているか、インターネットにつながっているかを確かめてください');
    renderPanel(); return;
  }
  // 読み込めたリンクだけを覚える（まちがったリンクで、前のリンクを消さない）
  sheetUrl = String(url).trim();
  try { localStorage.setItem(STORE_KEY + ':sheet', sheetUrl); } catch { /* 覚えられなくても読み込みはできる */ }
  xlsxBytes = bytes;
  state.xlsxName = 'Googleスプレッドシート（' + new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + 'に読み込み）';
  await runExtract();
}

async function runExtract() {
  const d = state.data;
  try {
    const r = await extractEvents(xlsxBytes, { grade: d.grade, month: d.month });
    state.eventDays = r.days;
    state.extractWarnings = r.warnings;
    state.eventsFor = { grade: d.grade, month: d.month };
    toast(`${d.month}月の行事を読み込みました（${r.days.length}日分）`);
  } catch (e) {
    toast(e.message || String(e));
  }
  changed(); renderPanel();
}

// ---------- カリキュラム（学年ごと。毎月使うので、学年だよりの内容とは別に保存する） ----------
// curriculum[学年] = { name: ファイル名, sample: サンプルか, importedAt, warnings: [],
//                      subjects: [{ label, months: { 11: [行…] }, orig: { 11: [Wordの原文の行…] } }] }
const CUR_KEY = 'gakunen-dayori:curriculum';
let curriculum = (() => { try { return JSON.parse(localStorage.getItem(CUR_KEY)) || {}; } catch { return {}; } })();
function saveCurriculum() {
  try { localStorage.setItem(CUR_KEY, JSON.stringify(curriculum)); } catch { toast('カリキュラムをブラウザに保存できませんでした。「保存ファイルに書き出す」で保存してください。'); }
}
let curMonth = null;   // ⑥で表示している月（はじめは学年だよりの月）
const sameLines = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

async function importCurriculum(bytes, name, sample) {
  const g = state.data.grade;
  try {
    const r = isPdf(bytes) ? await extractCurriculumPdf(bytes) : await extractCurriculum(bytes);
    if (!r.subjects.length) { toast(r.warnings[0] || 'カリキュラムの表が見つかりませんでした'); return; }
    if (curriculum[g] && !confirm(`${g}年生のカリキュラムを、「${name}」の内容に置きかえます。よろしいですか？\n（⑥で直した内容は消えます）`)) return;
    const isSample = sample || r.subjects.some((s) => Object.values(s.months).flat().some((l) => l.includes('サンプル')));
    curriculum[g] = {
      name, sample: isSample, importedAt: today(), warnings: r.warnings,
      subjects: r.subjects.map((s) => ({ label: s.label, months: structuredClone(s.months), orig: structuredClone(s.months) })),
    };
    saveCurriculum(); renderPanel();
    toast(`${g}年生のカリキュラムを読み込みました（${r.subjects.length}教科）`);
  } catch (e) { toast(e.message || String(e)); }
}

// ---------- Googleドキュメント（共有リンク）からカリキュラムを読む ----------
// 学校のパソコンでファイルを選べないときのため。行事予定のスプレッドシートと同じしくみ。
// Googleから Word の形でダウンロードして、Wordを選んだときと同じように読む。リンクはこのブラウザにだけ覚える。
let curDocUrl = (() => { try { return localStorage.getItem(STORE_KEY + ':curdoc') || ''; } catch { return ''; } })();
// Googleドキュメントのリンクも、Googleドライブに置いたWordファイルのリンクも、同じ方法でダウンロードできる
const docIdOf = (url) => { const m = /\/(?:document\/d|file\/d)\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : null; };
async function loadCurDoc(url) {
  if (/\/spreadsheets\/d\//.test(String(url))) { toast('これはスプレッドシートのリンクです。カリキュラムの「ドキュメント」のリンクを貼ってください'); return; }
  const id = docIdOf(url);
  if (!id) { toast('Googleドキュメントのリンクではないようです。共有のリンク（https://docs.google.com/document/d/…）を貼ってください'); return; }
  toast('ドキュメントを読み込んでいます…');
  let bytes;
  try {
    const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=docx`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('not docx');   // Wordの形（PK）でなければ失敗
  } catch {
    toast('ドキュメントを読み込めませんでした。共有の設定が「リンクを知っている全員」になっているか、インターネットにつながっているかを確かめてください');
    return;
  }
  // 読み込めたリンクだけを覚える（まちがったリンクで、前のリンクを消さない）
  curDocUrl = String(url).trim();
  try { localStorage.setItem(STORE_KEY + ':curdoc', curDocUrl); } catch { /* 覚えられなくても読み込みはできる */ }
  await importCurriculum(bytes, 'Googleドキュメント', false);
}

function panelCurriculum() {
  const g = state.data.grade; const c = curriculum[g];
  const m = curMonth || state.data.month;
  let h = `<h2>${g}年生のカリキュラム</h2>
  <p class="help">教科の年間カリキュラム（Googleドキュメント・Word・PDF。横が月、縦が教科の表）を読み込むと、③学習予定に、その月の項目を原文のまま入れられます。学年ごとに、このブラウザに保存します（毎月使えます）。</p>
  <div class="adder"><label class="btn">カリキュラム（Word・PDF）を選ぶ<input id="f-cur" type="file" accept=".docx,.pdf,application/pdf" hidden></label>
  <button id="btn-cur-sample">サンプルで試す</button>
  ${c ? '<button id="btn-cur-del" class="small">このカリキュラムを消す</button>' : ''}</div>
  <div class="card sheet-card"><div class="card-head"><b>Googleドキュメントから読み込む</b></div>
    <div class="adder" style="margin:6px 0 0"><input id="f-curdoc" type="url" placeholder="https://docs.google.com/document/d/…" value="${esc(curDocUrl)}" style="flex:1;min-width:12em">
    <button id="btn-curdoc">ドキュメントから読み込む</button></div>
    <p class="help" style="margin:6px 0 0">学校のパソコンでファイルを選べないときは、こちらを使ってください。カリキュラムのWordをGoogleドライブに入れて開き、共有の設定を「リンクを知っている全員」にして、そのリンクを貼ります。リンクはこのブラウザが覚えます。</p></div>`;
  if (!c) return h + `<p class="help">まだ読み込んでいません。本物のカリキュラムが届くまでは「サンプルで試す」で動きを確かめられます（中身は「【サンプル】」と書いた仮のデータです）。</p>`;
  h += `<p class="help" style="margin:4px 0">読み込んだファイル：${esc(c.name)}（${esc(c.importedAt)}）</p>`;
  if (c.sample) h += '<div class="notice warn"><b>これはサンプル（仮のデータ）です。</b>本物のカリキュラムではありません。本物が届いたら、読み込み直してください。</div>';
  for (const w of c.warnings || []) h += `<div class="notice warn">⚠ ${esc(w)}</div>`;
  h += `<div class="adder"><label>表示する月 <select id="f-curmonth">${SCHOOL_MONTHS.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${x}月</option>`).join('')}</select></label>
    <span class="help" style="margin:0">教科の名前や項目は、ここで直せます（直したところには印が付きます）。</span></div>`;
  c.subjects.forEach((s, i) => {
    const cur = s.months[m] || []; const orig = (s.orig || {})[m] || [];
    const edited = !sameLines(cur, orig);
    h += `<div class="card"><div class="card-head"><input type="text" data-cu="label" data-i="${i}" value="${esc(s.label)}" style="max-width:8em" placeholder="教科">
      <div class="row-actions"><button class="small" data-cu="up" data-i="${i}" title="上へ">↑</button><button class="small" data-cu="down" data-i="${i}" title="下へ">↓</button><button class="small" data-cu="del" data-i="${i}" title="消す">×</button></div></div>
      <textarea rows="${Math.max(2, cur.length + 1)}" data-cu="lines" data-i="${i}" placeholder="（${m}月の項目はありません）">${esc(cur.join('\n'))}</textarea>
      ${edited ? `<div class="item-note">✎ 読み込んだ原文から変えています${orig.length ? `（原文：${esc(orig.join(' / '))}）` : '（原文では空）'} <button class="small" data-cu="revert" data-i="${i}">原文に戻す</button></div>` : ''}</div>`;
  });
  h += '<button id="btn-cur-add">＋ 教科を足す</button>';
  // 1年分の一覧
  h += `<details class="cur-all"><summary>1年分を一覧で見る</summary><div class="cur-table-wrap"><table class="cur-table"><tr><th></th>${SCHOOL_MONTHS.map((x) => `<th>${x}月</th>`).join('')}</tr>`
    + c.subjects.map((s) => `<tr><th>${esc(s.label)}</th>${SCHOOL_MONTHS.map((x) => `<td>${(s.months[x] || []).map(esc).join('<br>')}</td>`).join('')}</tr>`).join('')
    + '</table></div></details>';
  return h;
}

// ---------- ③ 学習予定 ----------
function panelLearning() {
  const c = curriculum[state.data.grade]; const m = state.data.month;
  let h = `<h2>${m}月の学習予定</h2><p class="help">教科ごとに、1行ずつ書いてください（改行すると次の行になります）。</p>`;
  if (c) {
    h += `<div class="adder"><button id="btn-from-cur">カリキュラムから${m}月の分を入れる</button><span class="help" style="margin:0">⑥カリキュラムの${m}月の項目を、原文のまま入れます（カリキュラムにない教科の行は、そのまま残します）</span></div>`;
    if (c.sample) h += '<div class="notice warn">⑥のカリキュラムはサンプル（仮のデータ）です。本物のカリキュラムを読み込むまでは、学年だよりに使わないでください。</div>';
  } else {
    h += '<p class="help">⑥カリキュラムを読み込むと、ここにその月の項目を自動で入れられます。</p>';
  }
  state.data.learning.forEach((it, i) => {
    h += `<div class="card"><div class="card-head"><input type="text" data-lr="label" data-i="${i}" value="${esc(it.label)}" style="max-width:8em">
      <div class="row-actions"><button class="small" data-lr="up" data-i="${i}" title="上へ">↑</button><button class="small" data-lr="down" data-i="${i}" title="下へ">↓</button><button class="small" data-lr="del" data-i="${i}" title="消す">×</button></div></div>
      <textarea rows="${Math.max(2, it.lines.length + 1)}" data-lr="lines" data-i="${i}">${esc(it.lines.join('\n'))}</textarea></div>`;
  });
  return h + '<button id="btn-addsubject">＋ 教科を足す</button>';
}

// ---------- ④ あいさつ ----------
function panelGreeting() {
  return `<h2>はじめのあいさつ</h2>${aiBox('g')}
  <p class="help">改行すると、新しい段落になります（段落の頭は自動で1字下げます）。</p>
  <textarea id="f-greeting" rows="14">${esc(state.data.greeting.join('\n'))}</textarea>`;
}

// ---------- AIで文章を作る（ChatGPTなどに貼り付けて使う。アプリはAIを直接呼ばない） ----------
// t：'g'＝はじめのあいさつ、数字＝2ページ目の記事の番号
const AI_SITES = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { label: 'Claude', url: 'https://claude.ai/new' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app' },
  none: { label: '開かない（コピーだけ）', url: '' },
};
let aiSite = (() => { try { return localStorage.getItem(STORE_KEY + ':ai') || 'chatgpt'; } catch { return 'chatgpt'; } })();
if (!AI_SITES[aiSite]) aiSite = 'chatgpt';
const aiOpen = new Set();        // 開いている「AIで文章を作る」
const aiShow = new Set();        // お願いの文を表示しているもの
const aiResult = {};             // 貼り付けた返事（画面を描き直しても消えないように）
const aiTarget = (t) => (t === 'g' ? null : state.data.sections[Number(t)]);

/** あいさつの長さのめやす（今のあいさつ＋1ページ目の空き） */
function greetingLinesAuto() {
  const p1 = measurePage1(newsletterData());
  const free = Math.floor((p1.limit - 0.3 - p1.used) / LINE_CM);
  return Math.max(4, Math.min(14, p1.greetingLines + free - 1));
}
function aiLinesOf(t) {
  const sec = aiTarget(t);
  const v = sec ? sec.aiLines : state.data.greetingAiLines;
  return v || (sec ? 4 : greetingLinesAuto());
}
function aiPrompt(t) {
  const d = state.data; const sec = aiTarget(t);
  if (!sec) return greetingPrompt({ grade: d.grade, month: d.month, events: newsletterData().events, memo: d.greetingMemo, lines: aiLinesOf(t) });
  return sectionPrompt({ grade: d.grade, month: d.month, title: sec.title, kind: sec.kind || 'activity', memo: sec.memo, draft: sec.paragraphs || [], lines: aiLinesOf(t), fontSize: sec.fontSize || 11 });
}
function aiBox(t) {
  const d = state.data; const sec = aiTarget(t);
  const memo = sec ? sec.memo : d.greetingMemo;
  const auto = !(sec ? sec.aiLines : d.greetingAiLines);
  const range = sec ? [2, 3, 4, 5, 6, 7, 8, 10, 12] : [4, 5, 6, 7, 8, 9, 10, 11, 12, 14];
  const where = sec ? 'この記事' : 'あいさつ';
  const site = AI_SITES[aiSite];
  return `<details class="ai-box" data-ai-box="${t}" ${aiOpen.has(t) ? 'open' : ''}><summary>✨ AIで文章を作る（${site.url ? site.label : 'ChatGPTなど'}・無料）</summary>
    ${sec ? `<div class="ai-row"><label>記事の種類 <select data-ai="kind" data-t="${t}">${SECTION_KINDS.map((k) => `<option value="${k.value}" ${(sec.kind || 'activity') === k.value ? 'selected' : ''}>${k.label}</option>`).join('')}</select></label></div>` : ''}
    <label class="ai-label">メモ（箇条書きでかまいません）${sec ? '' : '　※なくても、月と行事予定から作れます'}</label>
    <textarea rows="4" data-ai="memo" data-t="${t}" placeholder="${sec ? '例：\n・10月15日 稲刈り体験\n・地域の方が協力してくださった\n・はじめは鎌に戸惑っていたが、だんだん上手に' : '例：\n・先月の運動会のお礼\n・林間学校に向けて準備中'}">${esc(memo || '')}</textarea>
    <div class="ai-row"><label>長さ <select data-ai="lines" data-t="${t}">${auto ? `<option value="" selected>自動（約${aiLinesOf(t)}行）</option>` : '<option value="">自動</option>'}${range.map((n) => `<option value="${n}" ${!auto && aiLinesOf(t) === n ? 'selected' : ''}>約${n}行</option>`).join('')}</select></label>
      <label>使うAI <select data-ai="site" data-t="${t}">${Object.entries(AI_SITES).map(([k, v]) => `<option value="${k}" ${k === aiSite ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
    <div class="notice info">子どもの名前は書かないでください。AIに渡すのは、学年・月・${sec ? '見出し・今の本文・' : '行事予定・'}このメモだけです（写真は渡しません）。</div>
    <ol class="ai-steps">
      <li><button class="primary" data-ai="copy" data-t="${t}">お願いの文をコピー${site.url ? `して ${site.label} を開く` : 'する'}</button> <button class="small" data-ai="show" data-t="${t}">${aiShow.has(t) ? 'お願いの文を閉じる' : 'お願いの文を見る'}</button>
        ${aiShow.has(t) ? `<textarea class="ai-prompt" rows="10" readonly data-ai="prompt" data-t="${t}">${esc(aiPrompt(t))}</textarea>` : ''}</li>
      <li>${site.url ? site.label : 'AI'}の入力欄に貼り付けて（Ctrl＋V）、送ります。</li>
      <li>返ってきた文章をコピーして、ここに貼り付けます。<textarea rows="5" data-ai="result" data-t="${t}" placeholder="ここに貼り付け">${esc(aiResult[t] || '')}</textarea>
        <button data-ai="apply" data-t="${t}">この文章を${where}に入れる</button>
        <span class="help" style="margin:0">入れたあとも、下の欄で自由に直せます。</span></li>
    </ol></details>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 下の方法で */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}
async function aiClick(t, btn) {
  const d = state.data; const sec = aiTarget(t);
  const action = btn.dataset.ai;
  if (action === 'show') { if (aiShow.has(t)) aiShow.delete(t); else aiShow.add(t); renderPanel(); return; }
  if (action === 'copy') {
    const memo = (sec ? sec.memo : d.greetingMemo) || '';
    const name = looksLikeNames(memo + '\n' + (sec ? (sec.paragraphs || []).join('\n') : ''));
    if (name && !confirm(`「${name}」のように、子どもの名前が入っていませんか？\n名前はAIに渡さないでください。このままコピーしてよいですか？`)) return;
    const site = AI_SITES[aiSite];
    // 先にコピーする（AIのページを先に開くと、このページから離れてコピーできないことがある）。
    // コピーはすぐ終わるので、そのあとに開いてもブラウザに止められない。
    const ok = await copyText(aiPrompt(t));
    const win = ok && site.url ? window.open(site.url, '_blank') : null;
    if (win) { try { win.opener = null; } catch { /* なし */ } }
    if (ok) toast(site.url ? `お願いの文をコピーしました。${site.label}の入力欄に貼り付けて（Ctrl＋V）送ってください` : 'お願いの文をコピーしました。AIの入力欄に貼り付けてください');
    else { aiShow.add(t); renderPanel(); toast('自動でコピーできませんでした。表示したお願いの文を選んでコピーしてください'); }
    if (ok && site.url && !win) toast(`${site.label}のページを開けませんでした。ブラウザで ${site.url} を開いてください（お願いの文はコピー済みです）`);
    return;
  }
  if (action === 'apply') {
    const paras = cleanAiText(aiResult[t] || '', { title: sec ? sec.title : '' });
    if (!paras.length) { toast('先に、AIから返ってきた文章を貼り付けてください'); return; }
    const cur = sec ? sec.paragraphs || [] : d.greeting;
    if (cur.length && !confirm(`今の${sec ? '記事の本文' : 'あいさつ'}を、貼り付けた文章（${paras.length}段落）に置きかえます。よろしいですか？`)) return;
    if (sec) sec.paragraphs = paras; else d.greeting = paras;
    aiResult[t] = '';
    toast(`${sec ? '記事の本文' : 'あいさつ'}に入れました。右のプレビューで、収まっているか確かめてください`);
    changed(); renderPanel();
  }
}

// ---------- ⑤ 2ページ目 ----------
function panelPage2() {
  newsletterData();   // 季節のイラストの置き場所（lastPlacement）を最新にする
  let h =`<h2>2ページ目の記事</h2><p class="help">改行すると新しい段落になります。下線を引きたいところは __このように__ 下線2本ずつではさみます。</p>
  <p class="help">写真は、このパソコンのブラウザの中だけに保存します（インターネットには送りません）。Wordでは白黒になります。並べ替えは、写真をドラッグするか ← → で行えます。<b>毎月1日をすぎて最初にアプリを開いたとき、前の月までに入れた写真は自動で消えます</b>（ロゴ・季節のイラストは消えません）。</p>
  <label class="help" style="display:block"><input type="checkbox" id="f-autofill" ${state.data.autoFill === false ? '' : 'checked'}> 2ページ目の下が大きく空いたときは、季節のイラストを入れる</label>
  ${seasonCard()}`;
  state.data.sections.forEach((s, i) => {
    const off = s.photoOff || [];
    const ids = s.photos || [];
    const missing = ids.filter((id) => !photoMeta.has(id)).length;
    const used = ids.filter((id) => photoMeta.has(id) && !off.includes(id)).length;
    h += `<div class="card"><div class="card-head"><input type="text" data-sc="title" data-i="${i}" value="${esc(s.title)}" placeholder="見出し">
      <select data-sc="fontSize" data-i="${i}" title="文字の大きさ">${[10.5, 11, 12].map((n) => `<option value="${n}" ${(s.fontSize || 11) === n ? 'selected' : ''}>${n}pt</option>`).join('')}</select>
      <div class="row-actions"><button class="small" data-sc="up" data-i="${i}" title="上へ">↑</button><button class="small" data-sc="down" data-i="${i}" title="下へ">↓</button><button class="small" data-sc="del" data-i="${i}" title="消す">×</button></div></div>
      <textarea rows="5" data-sc="paragraphs" data-i="${i}">${esc((s.paragraphs || []).join('\n'))}</textarea>
      ${aiBox(String(i))}
      <div class="photos" data-drop="${i}">`;
    ids.forEach((id, k) => {
      const m = photoMeta.get(id); if (!m) return;
      const isOff = off.includes(id);
      h += `<div class="thumb ${isOff ? 'off' : ''}" draggable="true" data-ph-sec="${i}" data-ph-id="${id}">
        <img src="${m.url}" alt="${esc(m.name)}" title="${esc(m.name)}" draggable="false">
        ${isOff ? '<span class="thumb-tag">使わない</span>' : `<span class="thumb-num">${ids.slice(0, k + 1).filter((x) => photoMeta.has(x) && !off.includes(x)).length}</span>`}
        <div class="thumb-btns"><button class="small" data-ph="left" data-i="${i}" data-id="${id}" title="前へ">←</button><button class="small" data-ph="right" data-i="${i}" data-id="${id}" title="後ろへ">→</button>
        <button class="small" data-ph="toggle" data-i="${i}" data-id="${id}" title="${isOff ? '学年だよりに載せる' : '学年だよりに載せない（写真は残す）'}">${isOff ? '使う' : '除外'}</button>
        <button class="small" data-ph="del" data-i="${i}" data-id="${id}" title="写真を消す">×</button></div></div>`;
    });
    h += `<label class="btn add-photo">＋ 写真を入れる<input type="file" accept="image/*" multiple data-ph-add="${i}" hidden><small>ここに写真をドラッグしても入れられます</small></label></div>
      ${missing ? `<div class="notice warn">このブラウザに保存されていない写真が${missing}枚分あります（別のパソコンで入れた写真など）。もう一度入れ直してください。</div>` : ''}
      ${used ? `<div class="photo-opts"><label>1行の枚数 <select data-sc="perRow" data-i="${i}">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${(s.perRow || 0) === n ? 'selected' : ''}>${n ? n + '枚' : '自動'}</option>`).join('')}</select></label>
      <label>写真の大きさ <select data-sc="photoSize" data-i="${i}">${[0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5].map((n) => `<option value="${n}" ${(s.photoSize || 1) === n ? 'selected' : ''}>${n === 1 ? 'ふつう' : Math.round(n * 100) + '%'}</option>`).join('')}</select></label>
      <span class="help" style="margin:0">載せる写真：${used}枚</span></div>` : ''}
      ${sectionIllustOpts(s, i)}</div>`;
  });
  return h + '<button id="btn-addsection">＋ 記事を足す</button>';
}

// 季節のイラスト（月ごとに何枚でも登録して、毎年その月に使う）
let seasonOpen = false;   // 「ほかの月」を開いているか（画面を描き直しても閉じないように）
/** その絵を今どこに置いているか（今月の分だけ） */
function whereIs(id) {
  if (lastPlacement.box === id) return '1ページ目：行事予定の枠の下';
  if (lastPlacement.fill === id) return state.data.autoFill === false ? '下の空き（今は入れない設定）' : '大きく：下の空き';
  const s = lastPlacement.spots.find((x) => x.id === id);
  if (!s) return '使っていない';
  const title = state.data.sections[s.si] && state.data.sections[s.si].title;
  return `小さく：「${title || '（見出しなし）'}」の${s.kind === 'title' ? '見出しの横' : '終わり'}`;
}
function seasonPoolHtml(m, current) {
  const ids = seasonPool(m);
  let h = `<div class="ill-pool ${current ? '' : 'mini'}" data-ill-drop="season" data-m="${m}">`;
  ids.forEach((id, k) => {
    const meta = illustMeta.get(id);
    h += `<div class="ill-thumb"><span class="thumb-num">${k + 1}</span><img class="gray" src="${meta.url}" alt="${esc(meta.name)}" title="${esc(meta.name)}">
      ${current ? `<span class="ill-where">${esc(whereIs(id))}</span>` : ''}
      <button class="small ill-x" data-ill-del="season" data-id="${id}" data-m="${m}" title="この絵を消す">×</button></div>`;
  });
  h += `<label class="btn add-photo ill-add">＋ 絵を入れる<input type="file" accept="image/png,image/jpeg" multiple data-ill-add="season" data-m="${m}" hidden>${current ? '<small>何枚でも入れられます。ここにドラッグしても入ります</small>' : ''}</label></div>`;
  if (current) {
    // アプリに最初から入っている絵（消せない。使わないときは、置き場所の選択で「なし」や別の絵にする）
    const builtins = [seasonIllustOf(m), ...smallIllustsOf(m)];
    h += `<div class="help" style="margin:8px 0 2px">最初から入っている絵（このアプリのために描いた絵）</div><div class="ill-pool builtin-pool">`
      + builtins.map((id) => `<div class="ill-thumb builtin"><img src="${ILLUST_DIR + id}" alt="${esc(illLabel(m, id))}" title="${esc(illLabel(m, id))}"><span class="ill-where"><b>${esc(illLabel(m, id).replace('最初からある', ''))}</b><br>${esc(whereIs(id))}</span></div>`).join('')
      + `<div class="ill-thumb builtin"><img src="${ILLUST_DIR + boxIllustOf(m)}" alt="枠の下の絵"><span class="ill-where"><b>枠の下の絵</b><br>${whereIs(boxIllustOf(m))}</span></div></div>`;
  }
  return h;
}
function seasonCard() {
  const d = state.data; const m = d.month;
  const ids = seasonPool(m);
  const others = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].filter((x) => x !== m);
  const months = new Set([...illustMeta.keys()].map(monthOfIllust).filter(Boolean));
  const usable = ids.filter((id) => id !== d.boxChoice);
  const fc = d.fillChoice && (d.fillChoice === 'default' || usable.includes(d.fillChoice)) ? d.fillChoice : '';
  const opt = (v, label) => `<option value="${v}" ${fc === v ? 'selected' : ''}>${label}</option>`;
  const autoFill = usable.length ? illLabel(m, usable[0]) : '最初からある大きい絵';
  return `<div class="card"><div class="card-head"><b>${m}月の季節のイラスト</b></div>
    ${seasonPoolHtml(m, true)}
    <div class="photo-opts"><label>下の空きに大きく入れる絵 <select id="f-fillchoice">${opt('', `自動（${autoFill}）`)}${usable.map((id) => opt(id, illLabel(m, id))).join('')}${opt('default', '最初からある大きい絵')}</select></label>
      <label><input type="checkbox" id="f-builtinsmall" ${d.builtinSmall === false ? '' : 'checked'}> 最初からある小さい絵も、空いているところに置く</label></div>
    <p class="help" style="margin:6px 0 0">取り込んだ絵は、毎年${m}月に使います。1枚を2ページ目の下の空きに大きく入れ、残りは小さくして、記事の「見出しの横」か「終わりの右」の空いているところに自動で置きます（取り込んだ絵が先、そのあとに最初からある小さい絵）。置き場所は、各記事の「イラスト」で変えられます。1ページ目の行事予定の枠の下の絵は、②行事予定のタブで選べます。
    取り込んだ絵はこのブラウザの中だけに保存し（インターネットには送りません）、Wordでは白黒になります。</p>
    <details id="season-more" ${seasonOpen ? 'open' : ''}><summary>ほかの月の絵も登録する（登録済み：${months.size - (months.has(m) ? 1 : 0)}か月）</summary>
    <div class="season-months">${others.map((x) => `<div class="season-month"><b>${x}月</b>${seasonPoolHtml(x, false)}</div>`).join('')}</div></details></div>`;
}
/** 記事ごとの「イラスト」の選びなおし（取り込んだ絵と、最初からある小さい絵から選ぶ） */
function sectionIllustOpts(sec, i) {
  const m = state.data.month;
  const ids = [...seasonPool(m).filter((id) => id !== state.data.boxChoice), ...smallIllustsOf(m)];
  const sel = (kind, key) => {
    const auto = lastPlacement.spots.find((s) => s.si === i && s.kind === kind && s.auto);
    const v = sec[key] === 'none' || ids.includes(sec[key]) ? sec[key] : '';
    const o = (val, label) => `<option value="${val}" ${v === val ? 'selected' : ''}>${label}</option>`;
    return `<select data-sc="${key}" data-i="${i}">${o('', `自動（${auto ? illLabel(m, auto.id) : 'なし'}）`)}${o('none', 'なし')}${ids.map((id) => o(id, illLabel(m, id))).join('')}</select>`;
  };
  return `<div class="photo-opts"><span>イラスト</span><label>見出しの横 ${sel('title', 'illTitle')}</label><label>終わりの右 ${sel('end', 'illEnd')}</label></div>`;
}

// ---------- 入力の受け取り ----------
const lines = (v) => v.split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim() !== '');
const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

$('#panel').addEventListener('input', (e) => {
  const t = e.target; const d = state.data; const i = Number(t.dataset.i);
  if (t.dataset.bind) {
    if (t.dataset.bind === 'grade' || t.dataset.bind === 'month') return; // change で処理
    d[t.dataset.bind] = t.value;
  } else if (t.id === 'f-greeting') d.greeting = lines(t.value);
  else if (t.dataset.ev === 'text') state.eventDays[t.dataset.d].items[i].text = t.value;
  else if (t.dataset.lr === 'label') d.learning[i].label = t.value;
  else if (t.dataset.lr === 'lines') d.learning[i].lines = lines(t.value);
  else if (t.dataset.sc === 'title') d.sections[i].title = t.value;
  else if (t.dataset.sc === 'paragraphs') d.sections[i].paragraphs = lines(t.value);
  else if (t.dataset.ai === 'memo') { const sec = aiTarget(t.dataset.t); if (sec) sec.memo = t.value; else d.greetingMemo = t.value; save(); refreshPrompt(t.dataset.t); return; }
  else if (t.dataset.ai === 'result') { aiResult[t.dataset.t] = t.value; return; }
  else if (t.dataset.cu === 'label' || t.dataset.cu === 'lines') {
    const s = curriculum[d.grade].subjects[i];
    if (t.dataset.cu === 'label') s.label = t.value.trim(); else s.months[curMonth || d.month] = lines(t.value);
    saveCurriculum(); return;
  } else return;
  changed();
});

$('#panel').addEventListener('change', async (e) => {
  const t = e.target; const d = state.data; const i = Number(t.dataset.i);
  if (t.dataset.bind === 'grade' || t.dataset.bind === 'month') {
    d[t.dataset.bind] = Number(t.value);
    if (xlsxBytes) await runExtract();
    changed(); renderPanel(); return;   // 学年のロゴの表示も変える
  }
  if (t.id === 'f-xlsx' && t.files[0]) {
    const f = t.files[0];
    xlsxBytes = new Uint8Array(await f.arrayBuffer());
    state.xlsxName = f.name;
    await runExtract(); return;
  }
  if (t.id === 'f-showex') { showExcluded = t.checked; renderPanel(); return; }
  if (t.id === 'f-cur' && t.files[0]) { const f = t.files[0]; t.value = ''; await importCurriculum(new Uint8Array(await f.arrayBuffer()), f.name, false); return; }
  if (t.id === 'f-curmonth') { curMonth = Number(t.value); renderPanel(); return; }
  if (t.dataset.ai === 'kind' || t.dataset.ai === 'lines') {
    const sec = aiTarget(t.dataset.t); const v = t.dataset.ai === 'kind' ? t.value : Number(t.value) || undefined;
    if (sec) sec[t.dataset.ai === 'kind' ? 'kind' : 'aiLines'] = v; else d.greetingAiLines = v;
    save(); renderPanel(); return;
  }
  if (t.dataset.ai === 'site') { aiSite = t.value; try { localStorage.setItem(STORE_KEY + ':ai', aiSite); } catch { /* なし */ } renderPanel(); return; }
  if (t.dataset.cu === 'lines') { renderPanel(); return; }   // 書き終えたら「直した」の印を出し直す
  if (t.dataset.ev === 'include') { state.eventDays[t.dataset.d].items[i].include = t.checked; changed(); renderPanel(); return; }
  if (t.dataset.sc === 'fontSize') { d.sections[i].fontSize = Number(t.value); changed(); }
  if (t.id === 'f-autofill') { d.autoFill = t.checked; changed(); return; }
  if (t.dataset.sc === 'perRow') { d.sections[i].perRow = Number(t.value) || undefined; changed(); }
  if (t.dataset.sc === 'photoSize') { d.sections[i].photoSize = Number(t.value); changed(); }
  if (t.dataset.phAdd !== undefined && t.files.length) { const files = [...t.files]; t.value = ''; await addPhotos(Number(t.dataset.phAdd), files); }
  if (t.dataset.illAdd && t.files.length) { const files = [...t.files]; t.value = ''; await addIllustFiles(t.dataset.illAdd, Number(t.dataset.m), files); }
  if (t.id === 'f-boxchoice') { if (t.value) d.boxChoice = t.value; else delete d.boxChoice; changed(); renderPanel(); return; }
  if (t.id === 'f-builtinsmall') { d.builtinSmall = t.checked; changed(); renderPanel(); return; }
  if (t.id === 'f-fillchoice') { if (t.value) d.fillChoice = t.value; else delete d.fillChoice; changed(); renderPanel(); }
  if (t.dataset.sc === 'illTitle' || t.dataset.sc === 'illEnd') {
    const sec = d.sections[i]; if (t.value) sec[t.dataset.sc] = t.value; else delete sec[t.dataset.sc];
    changed(); renderPanel();
  }
});
$('#panel').addEventListener('toggle', (e) => {
  if (e.target.id === 'season-more') seasonOpen = e.target.open;
  const t = e.target.dataset && e.target.dataset.aiBox;
  if (t !== undefined) { if (e.target.open) aiOpen.add(t); else aiOpen.delete(t); }
}, true);
/** 表示中のお願いの文を、メモに合わせて書きかえる */
function refreshPrompt(t) {
  const ta = document.querySelector(`textarea[data-ai="prompt"][data-t="${t}"]`); if (ta) ta.value = aiPrompt(t);
}

/** ロゴ（1枚）か、季節のイラスト（何枚でも）を取り込む */
async function addIllustFiles(kind, month, files) {
  const d = state.data;
  if (kind === 'logo') {
    if (await setIllust(logoKey(d.grade), 'logo', files[0])) { toast(`${d.grade}年生のロゴを設定しました`); changed(); renderPanel(); }
    return;
  }
  let n = 0;
  for (const f of files) if (await setIllust(newSeasonId(month), 'season', f)) n++;
  if (n) { toast(`${month}月の季節のイラストを${n}枚入れました（毎年${month}月に使います）`); changed(); renderPanel(); }
}
async function removeIllustOf(kind, month, id) {
  const d = state.data;
  if (kind === 'logo') {
    if (!confirm(DEFAULT_LOGO[d.grade] ? `${d.grade}年生のロゴを、最初のロゴに戻しますか？` : `${d.grade}年生のロゴを外しますか？（ロゴなしになります）`)) return;
    await removeIllust(logoKey(d.grade));
  } else {
    if (!confirm(`${month}月の季節のイラストの「${illLabel(month, id)}」を消しますか？（このブラウザから消えます）`)) return;
    await removeIllust(id);
    // この絵を選んでいたところは「自動」に戻す
    if (d.fillChoice === id) delete d.fillChoice;
    if (d.boxChoice === id) delete d.boxChoice;
    for (const s of d.sections) { if (s.illTitle === id) delete s.illTitle; if (s.illEnd === id) delete s.illEnd; }
  }
  changed(); renderPanel();
}

// 写真のドラッグ（並べ替え・ほかの記事への移動・パソコンからの追加）
let dragging = null;
$('#panel').addEventListener('dragstart', (e) => {
  const th = e.target.closest && e.target.closest('.thumb'); if (!th) return;
  dragging = { sec: Number(th.dataset.phSec), id: th.dataset.phId };
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging.id);
});
$('#panel').addEventListener('dragend', () => { dragging = null; document.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on')); });
$('#panel').addEventListener('dragover', (e) => {
  const area = e.target.closest && e.target.closest(dragging ? '[data-drop]' : '[data-drop], [data-ill-drop]'); if (!area) return;
  e.preventDefault();
  document.querySelectorAll('.drop-on').forEach((x) => { if (x !== area) x.classList.remove('drop-on'); });
  area.classList.add('drop-on');
});
$('#panel').addEventListener('drop', async (e) => {
  const ill = !dragging && e.target.closest && e.target.closest('[data-ill-drop]');
  if (ill) {
    e.preventDefault(); ill.classList.remove('drop-on');
    if (e.dataTransfer.files.length) await addIllustFiles(ill.dataset.illDrop, Number(ill.dataset.m), [...e.dataTransfer.files]);
    return;
  }
  const area = e.target.closest && e.target.closest('[data-drop]'); if (!area) return;
  e.preventDefault(); area.classList.remove('drop-on');
  const si = Number(area.dataset.drop);
  if (!dragging) { if (e.dataTransfer.files.length) await addPhotos(si, e.dataTransfer.files); return; }
  const from = state.data.sections[dragging.sec]; const to = state.data.sections[si];
  const target = e.target.closest('.thumb');
  from.photos = from.photos.filter((x) => x !== dragging.id);
  const wasOff = (from.photoOff || []).includes(dragging.id);
  if (from !== to) from.photoOff = (from.photoOff || []).filter((x) => x !== dragging.id);
  to.photos = to.photos || [];
  let pos = to.photos.length;
  if (target && target.dataset.phId !== dragging.id) {
    pos = to.photos.indexOf(target.dataset.phId);
    const r = target.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) pos++;
  }
  to.photos.splice(pos, 0, dragging.id);
  if (from !== to && wasOff) to.photoOff = [...(to.photoOff || []), dragging.id];
  dragging = null; changed(); renderPanel();
});

$('#panel').addEventListener('click', async (e) => {
  if (e.target.id === 'btn-sheet') { await loadSheet($('#f-sheet').value); return; }
  if (e.target.id === 'btn-curdoc') { await loadCurDoc($('#f-curdoc').value); return; }
  const t = e.target.closest('button'); if (!t) return;
  const d = state.data; const i = Number(t.dataset.i);
  if (t.id === 'btn-reextract') { await runExtract(); return; }
  if (t.dataset.illDel) { await removeIllustOf(t.dataset.illDel, Number(t.dataset.m), t.dataset.id); return; }
  if (await curriculumClick(t, d, i)) return;
  if (t.dataset.ai) { await aiClick(t.dataset.t, t); return; }
  if (t.id === 'btn-addday') {
    const n = Number($('#f-newday').value);
    if (!(n >= 1 && n <= 31)) { toast('1〜31の日にちを入れてください'); return; }
    const y = yearOfMonth(d.month);
    if (new Date(y, d.month - 1, n).getMonth() !== d.month - 1) { toast(`${d.month}月${n}日はありません`); return; }
    let day = state.eventDays.find((x) => x.day === n);
    if (!day) { day = { day: n, weekday: weekdayOf(y, d.month, n), items: [] }; state.eventDays.push(day); state.eventDays.sort((a, b) => a.day - b.day); }
    day.items.push(manualItem());
    if (!state.eventsFor) state.eventsFor = { grade: d.grade, month: d.month };
  } else if (t.dataset.ev === 'addItem') state.eventDays[t.dataset.d].items.push(manualItem());
  else if (t.dataset.ev === 'del') {
    const day = state.eventDays[t.dataset.d]; day.items.splice(i, 1);
    if (!day.items.length) state.eventDays.splice(Number(t.dataset.d), 1);
  } else if (t.id === 'btn-addsubject') d.learning.push({ label: '', lines: [] });
  else if (t.dataset.lr === 'up' || t.dataset.lr === 'down') move(d.learning, i, t.dataset.lr === 'up' ? -1 : 1);
  else if (t.dataset.lr === 'del') { if (!confirm(`「${d.learning[i].label || '（名前なし）'}」を消しますか？`)) return; d.learning.splice(i, 1); }
  else if (t.id === 'btn-addsection') d.sections.push({ title: '', fontSize: 11, paragraphs: [] });
  else if (t.dataset.sc === 'up' || t.dataset.sc === 'down') move(d.sections, i, t.dataset.sc === 'up' ? -1 : 1);
  else if (t.dataset.sc === 'del') {
    const n = (d.sections[i].photos || []).length;
    if (!confirm(`記事「${d.sections[i].title || '（見出しなし）'}」を消しますか？${n ? `\n（この記事の写真${n}枚も消えます）` : ''}`)) return;
    const [gone] = d.sections.splice(i, 1); await removePhotos(gone.photos || []);
  } else if (t.dataset.ph) {
    const s = d.sections[i]; const id = t.dataset.id; const k = s.photos.indexOf(id);
    if (t.dataset.ph === 'left') move(s.photos, k, -1);
    else if (t.dataset.ph === 'right') move(s.photos, k, 1);
    else if (t.dataset.ph === 'toggle') {
      const off = s.photoOff || [];
      s.photoOff = off.includes(id) ? off.filter((x) => x !== id) : [...off, id];
    } else if (t.dataset.ph === 'del') {
      if (!confirm('この写真を消しますか？（このブラウザからも消えます）')) return;
      s.photos.splice(k, 1); s.photoOff = (s.photoOff || []).filter((x) => x !== id); await removePhotos([id]);
    }
  } else return;
  changed(); renderPanel();
  if (t.id === 'btn-addday' || t.dataset.ev === 'addItem') {
    const inputs = [...document.querySelectorAll('.item input[type=text]')].filter((x) => !x.value);
    if (inputs.length) inputs[inputs.length - 1].focus();
  }
});
/** 教科名を比べるための形（空白を除き、同じ教科の別の呼び方をそろえる） */
const SUBJECT_ALIAS = { 図工: '図画工作', 家庭科: '家庭', 外国語活動: '外国語', 英語: '外国語', 総合的な学習の時間: '総合', 特別の教科道徳: '道徳' };
function subjectKey(label) {
  const k = String(label || '').replace(/[\s　]+/g, '');
  return SUBJECT_ALIAS[k] || k;
}
/** ⑥カリキュラムと、③の「カリキュラムから入れる」のボタン。処理したら true */
async function curriculumClick(t, d, i) {
  const g = d.grade; const c = curriculum[g];
  if (t.id === 'btn-cur-sample') {
    try {
      const r = await fetch('assets/curriculum-sample.docx'); if (!r.ok) throw new Error();
      await importCurriculum(new Uint8Array(await r.arrayBuffer()), 'サンプル（仮のデータ）', true);
    } catch { toast('サンプルを読み込めませんでした'); }
    return true;
  }
  if (t.id === 'btn-from-cur' && c) {
    const m = d.month;
    const filled = d.learning.some((it) => it.lines.length);
    if (filled && !confirm(`今の学習予定を、カリキュラムの${m}月の項目に置きかえます。よろしいですか？`)) return true;
    // カリキュラムにない教科（道徳・総合など）の行は、書いてある内容ごと下に残す
    const inCur = new Set(c.subjects.map((s) => subjectKey(s.label)));
    const kept = d.learning.filter((it) => subjectKey(it.label) && !inCur.has(subjectKey(it.label)));
    d.learning = [...c.subjects.map((s) => ({ label: s.label, lines: [...(s.months[m] || [])] })), ...kept.map((it) => ({ ...it, lines: [...it.lines] }))];
    const n = d.learning.length - kept.length;
    toast(`カリキュラムから${m}月の分を入れました（${n}教科）${kept.length ? `。${kept.map((it) => it.label).join('・')}は、そのまま残しています` : ''}${c.sample ? '。サンプルのデータです' : ''}`);
    changed(); renderPanel(); return true;
  }
  if (!c) return false;
  if (t.id === 'btn-cur-del') {
    if (!confirm(`${g}年生のカリキュラムを、このブラウザから消しますか？`)) return true;
    delete curriculum[g];
  } else if (t.id === 'btn-cur-add') c.subjects.push({ label: '', months: {}, orig: {} });
  else if (t.dataset.cu === 'up' || t.dataset.cu === 'down') move(c.subjects, i, t.dataset.cu === 'up' ? -1 : 1);
  else if (t.dataset.cu === 'del') { if (!confirm(`「${c.subjects[i].label || '（名前なし）'}」を、1年分すべて消しますか？`)) return true; c.subjects.splice(i, 1); }
  else if (t.dataset.cu === 'revert') { const s = c.subjects[i]; const m = curMonth || d.month; s.months[m] = [...((s.orig || {})[m] || [])]; }
  else return false;
  saveCurriculum(); renderPanel(); return true;
}
const manualItem = () => ({ raw: '', text: '', include: true, kind: 'event', reason: '手で足した行事', warn: '', grades: null });

// ---------- プレビューと、2ページに収まっているかのチェック ----------
const illustSize = (n) => { const [w, h] = ILLUST_SIZE[n] || [2, 2]; return { width: w * 100, height: h * 100 }; };
let previewTimer = null;
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 250); }

function checkFit(d) {
  const p1 = measurePage1(d);
  const fit = choosePhotoLayout(d.sections || [], (id) => photoMeta.get(id), illustSize);
  const room1 = p1.limit - 0.3 - p1.used;
  const room2 = PAGE_BODY_HEIGHT_CM - 0.8 - fit.fixed - fit.photo * fit.scale;
  return { p1, fit, room1, room2, fill: fillIllustOf(d, fit), ok: room1 >= 0 && fit.fits };
}

function updatePreview() {
  const d = newsletterData();
  const c = checkFit(d);
  const lineMsg = (room) => (room >= 0 ? `あと約${Math.floor(room / LINE_CM)}行` : `約${Math.ceil(-room / LINE_CM)}行はみ出しています`);
  $('#fit').innerHTML = `<span class="badge ${c.room1 >= 0 ? 'ok' : 'ng'}">1ページ目：${c.room1 >= 0 ? '収まっています' : 'はみ出しています'}（${lineMsg(c.room1)}）</span>`
    + `<span class="badge ${c.fit.fits ? 'ok' : 'ng'}">2ページ目：${c.fit.fits ? '収まっています' : 'はみ出しています'}（${c.fill ? '下の空きは季節のイラストで埋めています' : lineMsg(c.room2)}）</span>`
    + (c.p1.learningScale < 1 ? `<span class="badge info">1ページ目に収めるため、学習予定の文字を${Math.round(c.p1.learningScale * 100)}%の大きさにしています</span>` : '')
    + (c.room1 < 0 ? '<span class="badge ng">あいさつ・行事・学習予定のどれかを短くしてください</span>' : '')
    + (!c.fit.fits ? `<span class="badge ng">${d.sections.some((s) => s.perRow || (s.photoSize || 1) > 1)
      ? '「1行の枚数」を増やすか「写真の大きさ」を小さくするか、記事か写真を減らしてください' : '2ページ目の記事か写真を減らしてください'}</span>` : '')
    + (c.fit.fits && c.fit.photo && c.fit.scale < 0.999 ? `<span class="badge ok">2ページに収めるため、写真を${Math.round(c.fit.scale * 100)}%の大きさにしています</span>` : '');
  $('#preview').innerHTML = renderPreview(d, urlOf,(id) => photoMeta.get(id), { perRow: c.fit.perRow, scale: c.fit.scale, fill: c.fill });
  applyZoom();
}
function applyZoom() { $('#preview').style.zoom = $('#zoom').value; }
$('#zoom').addEventListener('input', () => { applyZoom(); try { localStorage.setItem(STORE_KEY + ':zoom', $('#zoom').value); } catch { /* 保存できなくても使える */ } });
try { const z = localStorage.getItem(STORE_KEY + ':zoom'); if (z) $('#zoom').value = z; } catch { /* なし */ }

// ---------- Wordファイルを作る ----------
let assetCache = null;
async function loadAssets(names) {
  const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} を読み込めませんでした`); return new Uint8Array(await r.arrayBuffer()); };
  if (!assetCache) assetCache = { template: await get('assets/template.docx'), illust: {} };
  for (const n of names) if (!assetCache.illust[n]) assetCache.illust[n] = await get(ILLUST_DIR + n);
  return assetCache;
}
/** 発行前の確認を出す。「このまま作る」なら true */
function askPrecheck(items) {
  const dlg = $('#precheck');
  $('#precheck-list').innerHTML = items.map((x, k) => `<li><b>${esc(x.title)}</b>${x.detail ? `<div class="detail">${esc(x.detail)}</div>` : ''}
    <button class="small" data-go="${k}">${esc(TABS.find(([key]) => key === x.tab)[1])} を開く</button></li>`).join('');
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); dlg.onclick = null; resolve(v); };
    dlg.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'precheck-go') done(true);
      else if (b.id === 'precheck-back') done(false);
      else if (b.dataset.go) { tab = items[Number(b.dataset.go)].tab; renderTabs(); renderPanel(); done(false); }
    };
    dlg.oncancel = () => resolve(false);   // Escキー
    dlg.showModal();
  });
}

$('#btn-word').addEventListener('click', async () => {
  const d = newsletterData();
  const c = checkFit(d);
  const items = precheck(d, c, { curriculum: curriculum[d.grade], lastIssued: state.lastIssued, photoAspectOf: (id) => photoMeta.get(id), illustAspectOf: illustSize });
  if (items.length && !(await askPrecheck(items))) return;
  const btn = $('#btn-word'); btn.disabled = true; btn.textContent = '作っています…';
  try {
    const heads = headImagesOf(d.month);
    const names = new Set([...BASE_ILLUST, heads.events, heads.learning, d.eventsIllust, d.logo, d.fillIllust || seasonIllustOf(d.month),
      ...d.sections.flatMap((s) => [s.titleIllust, s.endIllust])].filter(Boolean));
    // 先生が取り込んだロゴ・季節のイラストは、ブラウザの中から読む（それ以外はアプリの素材）
    const own = [...names].filter((n) => illustMeta.has(n));
    const a = await loadAssets([...names].filter((n) => !illustMeta.has(n)));
    const illust = { ...a.illust };
    for (const n of own) { const rec = await getPhoto(n); if (rec) illust[n] = new Uint8Array(await rec.blob.arrayBuffer()); }
    const photos = {};
    for (const id of d.sections.flatMap((s) => s.photos || [])) {
      const rec = await getPhoto(id); if (rec) photos[id] = new Uint8Array(await rec.blob.arrayBuffer());
    }
    const bytes = await buildDocx(d, { template: a.template, illust, photos }, { grayscale: true });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const link = document.createElement('a'); link.href = url; link.download = fileNameOf(d.grade, d.month); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`「${link.download}」を作りました（ダウンロードのフォルダに入ります）`);
    // 次の号で「前の号の文が残っていないか」を調べるために、作った号の文を覚えておく
    state.lastIssued = { month: d.month, greeting: [...d.greeting], sections: d.sections.map((s) => ({ paragraphs: [...(s.paragraphs || [])] })), learning: d.learning.flatMap((it) => it.lines) };
    save();
  } catch (e) {
    toast('Wordファイルを作れませんでした：' + (e.message || e));
  } finally { btn.disabled = false; btn.textContent = 'Wordファイルを作る'; }
});

// ---------- 保存ファイル（書き出し・読み込み）と作り直し ----------
$('#btn-export').addEventListener('click', async () => {
  const d = state.data;
  const ids = allPhotoIds().filter((id) => photoMeta.has(id));
  const withPhotos = ids.length > 0 && confirm(`写真（${ids.length}枚）も保存ファイルに入れますか？\n\nOK：写真も入れる（別のパソコンでも写真が使えます。ファイルが大きくなります。子どもの写真が入るので、ファイルの扱いに気をつけてください）\nキャンセル：文章だけ保存する`);
  const out = { app: 'gakunen-dayori', ...state };
  // カリキュラム、学年ごとのロゴと季節のイラストは、いつも入れる（子どもの写真ではないので確認しない）
  out.curriculum = curriculum;
  out.illustFiles = [];
  for (const id of illustMeta.keys()) {
    const rec = await getPhoto(id);
    if (rec) out.illustFiles.push({ id, kind: rec.kind, name: rec.name, type: rec.type, width: rec.width, height: rec.height, addedAt: rec.addedAt, data: await blobToBase64(rec.blob) });
  }
  if (withPhotos) {
    out.photoFiles = [];
    for (const id of ids) { const rec = await getPhoto(id); if (rec) out.photoFiles.push({ id, name: rec.name, width: rec.width, height: rec.height, data: await blobToBase64(rec.blob) }); }
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `学年だより_保存_${d.grade}年生_${d.month}月${withPhotos ? '_写真あり' : ''}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('#file-import').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    const s = newState();
    if (obj.data) Object.assign(s, obj);
    else { // 学年だよりの内容だけのファイル（テスト用データなど）
      s.data = { ...s.data, ...obj };
      s.eventDays = (obj.events || []).map((ev) => ({ day: ev.day, weekday: ev.weekday, items: [{ raw: '', text: ev.text, include: true, kind: 'event', reason: '', warn: '' }] }));
      s.eventsFor = { grade: s.data.grade, month: s.data.month };
    }
    const photoFiles = obj.photoFiles || [];
    const illustFiles = (obj.illustFiles || []).filter((p) => (SEASON_ID.test(p.id) || /^user-logo-g\d$/.test(p.id)) && p.data);
    const curIn = obj.curriculum && typeof obj.curriculum === 'object' ? obj.curriculum : {};
    const curGrades = Object.keys(curIn).filter((g) => curIn[g] && Array.isArray(curIn[g].subjects));
    delete s.data.events; delete s.app; delete s.photoFiles; delete s.illustFiles; delete s.curriculum;
    delete s.data.logo; delete s.data.fillIllust; delete s.data.fillAspect; delete s.data.fillGray; delete s.data.grayIllusts;
    s.data.greeting = s.data.greeting || []; s.data.learning = s.data.learning || []; s.data.sections = s.data.sections || [];
    // 写真の並べ方を細かく決めたデータ（テスト用）は、写真の順番だけを使う
    s.data.sections.forEach((sec) => {
      if (sec.photoRows) { sec.photos = [...(sec.photos || []), ...sec.photoRows.flat().filter((x) => x.photo).map((x) => x.photo)]; delete sec.photoRows; }
    });
    const extra = [photoFiles.length ? `写真${photoFiles.length}枚` : '', illustFiles.length ? `ロゴ・季節のイラスト${illustFiles.length}枚` : '',
      curGrades.length ? `${curGrades.map((g) => g + '年生').join('・')}のカリキュラム` : ''].filter(Boolean).join('、');
    if (!confirm(`今の内容を、読み込んだファイルの内容に置きかえます。${extra ? `（${extra}も入れます）` : ''}よろしいですか？`)) return;
    const before = allPhotoIds();
    for (const p of photoFiles) {
      const rec = { id: p.id, name: p.name, width: p.width, height: p.height, blob: base64ToBlob(p.data), addedAt: Date.now() };
      await putPhoto(rec); addMeta(rec);
    }
    // ロゴ・季節のイラストは、同じものだけ置きかえ、ほかはそのまま残す（季節のイラストは取り込んだ順を保つ）
    for (const [k, p] of illustFiles.entries()) {
      const type = p.type || 'image/jpeg';
      const rec = { id: p.id, kind: p.kind || (p.id.includes('logo') ? 'logo' : 'season'), name: p.name, type, width: p.width, height: p.height, blob: base64ToBlob(p.data, type), addedAt: p.addedAt || Date.now() + k };
      await putPhoto(rec); addIllustMeta(rec);
    }
    // カリキュラムは、ファイルに入っている学年の分だけ置きかえる
    for (const g of curGrades) curriculum[g] = curIn[g];
    if (curGrades.length) saveCurriculum();
    state = s; xlsxBytes = null;
    const keep = new Set(allPhotoIds()); await removePhotos(before.filter((id) => !keep.has(id)));
    changed(); renderPanel();
    toast(photoFiles.length ? `読み込みました（写真${photoFiles.length}枚）` : '読み込みました');
  } catch {
    toast('このファイルは読み込めませんでした。「保存ファイルに書き出す」で作ったファイルを選んでください。');
  }
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('入力した内容と写真をすべて消して、新しく作り直します。よろしいですか？\n（カリキュラム、学年のロゴ、季節のイラストは残ります。必要なら先に「保存ファイルに書き出す」をしてください）')) return;
  const keep = { school: state.data.school, grade: state.data.grade };
  const lastIssued = state.lastIssued;
  await removePhotos([...photoMeta.keys()]);
  state = newState(); Object.assign(state.data, keep); xlsxBytes = null;
  if (lastIssued) state.lastIssued = lastIssued;
  changed(); renderPanel();
});

let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000); }

renderTabs(); renderPanel(); updatePreview();
monthlyPhotoCleanup().then(loadPhotoMeta).then(() => { renderPanel(); updatePreview(); });
