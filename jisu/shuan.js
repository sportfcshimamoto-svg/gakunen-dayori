// 週案のタブを作る：画面の動き（手順は2つだけ：①時間割を読み込む ②期間を選んで作る）
// すべてこのブラウザの中で処理する（時間割や週案をインターネットに送らない。週案はGoogleから読むだけ）。
import { openBook, readShuan, DAYS, SLOTS } from './jisu-core.js';
import {
  parseTsv, parseTimetable, imagePrompt, toShuanWord, planWeeks, pickTemplate,
  weekSheetXml, buildWeekBook, addDays, dateOf,
} from './shuan-core.js';

const KEY = 'gakunen-jimu:shuan:v2';
const JISU_KEY = 'gakunen-jimu:jisu:v1';
const CLASSES = ['1組', '2組'];
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const md = (iso) => { const d = dateOf(iso); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };

// 覚えておくこと（このブラウザだけ）：週案のリンク、さいごに読み込んだ時間割の文字
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
saved.text ||= {};
if (!saved.sheetUrl) { try { saved.sheetUrl = JSON.parse(localStorage.getItem(JISU_KEY))?.sheetUrl || ''; } catch { /* なし */ } }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 覚えられなくても使える */ } };

const st = { book: null, existing: [], loading: false, from: '', to: '', abOverride: {}, made: '', editUrl: false };
const parsed = (cls) => (saved.text[cls] ? parseTimetable(parseTsv(saved.text[cls])) : null);

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const schoolYear = () => { const d = new Date(); return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1; };

// ---------- 週案（ひな形とA週/B週のために読む） ----------
const sheetIdOf = (url) => { const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : null; };
async function loadShuan(url, quiet) {
  const id = sheetIdOf(url);
  if (!id) { if (!quiet) toast('Googleスプレッドシートのリンクではないようです。共有のリンク（https://docs.google.com/spreadsheets/d/…）を貼ってください'); return; }
  st.loading = true; render();
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('not xlsx');
    st.book = await openBook(bytes);
    st.existing = readShuan(st.book, schoolYear()).weeks;
    saved.sheetUrl = String(url).trim(); save(); st.editUrl = false;
    const last = st.existing[st.existing.length - 1];
    if (!st.from && last) st.from = addDays(last.monday, 7);
  } catch {
    st.book = null;
    toast('週案を読み込めませんでした。共有の設定が「リンクを知っている全員」になっているか、インターネットにつながっているかを確かめてください', 8000);
  }
  st.loading = false; render();
}

// ---------- 作る ----------
function weekList() {
  if (!st.book || !st.from || !st.to || st.from > st.to) return [];
  return planWeeks({ from: st.from, to: st.to, existing: st.existing, abOverride: st.abOverride });
}

async function makeFile() {
  const grids = Object.fromEntries(CLASSES.map((c) => [c, parsed(c)]).filter(([, p]) => p?.ok).map(([c, p]) => [c, p.grid]));
  const list = weekList().filter((w) => !w.exists);
  if (!list.length) { toast('作る週がありません。期間を確かめてください'); return; }
  try {
    const sheets = list.map((w) => ({ name: w.name, xml: weekSheetXml(pickTemplate(st.book.sheets, st.existing, w.ab), w, grids).xml }));
    const bytes = await buildWeekBook(st.book, sheets);
    const name = `週案_${list[0].name}〜${list[list.length - 1].name}.xlsx`.replace(/\//g, '-');   // ファイル名に「/」は使えない
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    st.made = name; render();
    toast(`「${name}」を保存しました`, 6000);
  } catch (e) {
    toast('ファイルを作れませんでした（' + (e.message || e) + '）', 8000);
  }
}

// ---------- 画面 ----------
const gridTable = (grid) => `<table class="tt"><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>
  ${SLOTS.map((s) => `<tr><th>${s === '朝' ? '朝' : s}</th>${DAYS.map((d) => `<td>${esc(grid[d][s])}</td>`).join('')}</tr>`).join('')}</table>`;

function render() {
  const ps = Object.fromEntries(CLASSES.map((c) => [c, parsed(c)]));
  const okCount = CLASSES.filter((c) => ps[c]?.ok).length;
  const ws = weekList();
  const todo = ws.filter((w) => !w.exists);

  $('#main').innerHTML = `
  <section class="step">
    <h2><span class="num">1</span>時間割を読み込む</h2>
    <p class="help">時間割のスプレッドシートで「月 火 水 木 金」の見出しから6校時まで（左の「1」「2」…の列もいっしょに）を選んでコピーし、組ごとに貼ります。プールや運動会の時間割に変わるときは、ここに貼りかえます。</p>
    <details><summary><b>画像しかないとき</b></summary>
      <p>①「お願い文をコピー」を押す ② ChatGPTに時間割の画像とお願い文を貼って送る ③ 返ってきた表を下に貼る</p>
      <button id="copyprompt">お願い文をコピー</button>
      <p class="help">読み取りまちがいがあるかもしれないので、貼ったあと下の表で必ず確かめてください。</p>
    </details>
    <div class="two">
      ${CLASSES.map((c) => `<div><h3>${c}</h3>
        <textarea data-cls="${c}" placeholder="${c}の時間割をここに貼る">${esc(saved.text[c] || '')}</textarea>
        ${!ps[c] ? '' : ps[c].ok ? `${gridTable(ps[c].grid)}${ps[c].warnings.map((w) => `<p class="ng">${esc(w)}</p>`).join('')}` : `<p class="ng">${esc(ps[c].reason)}</p>`}
      </div>`).join('')}
    </div>
  </section>

  <section class="step ${okCount ? '' : 'off'}">
    <h2><span class="num">2</span>週案を作る</h2>
    ${!st.book || st.editUrl ? `
      <div class="row"><span>週案のリンク：</span><input id="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(saved.sheetUrl || '')}">
        <button id="load" ${st.loading ? 'disabled' : ''}>${st.loading ? '読み込み中…' : '読み込む'}</button></div>
      <p class="help">週案の見た目と、前の週がA週かB週かを知るために読みます。リンクは覚えておくので、最初の1回だけです。</p>`
    : `<p class="help">週案：読み込みずみ（さいごの週は「${esc(st.existing[st.existing.length - 1]?.name || 'なし')}」）　<a href="#" id="editurl">リンクを変える</a>　<a href="#" id="reload">読み込みなおす</a></p>`}
    <div class="row" style="margin:10px 0"><b>この時間割を使う期間：</b>
      <input type="date" id="from" value="${esc(st.from)}"> から <input type="date" id="to" value="${esc(st.to)}"> まで</div>
    ${ws.length ? `<p class="help">この期間の週のタブを作ります。A週/B週がちがうときは、ボタンを押すと入れかわります（後の週も交互に直ります）。</p>
      <table class="weeks"><tr><th>タブ</th><th>週</th><th>A/B</th><th></th></tr>
      ${ws.map((w) => `<tr class="${w.exists ? 'dis' : ''}"><td>${esc(w.name)}</td><td>${md(w.monday)}〜</td>
        <td>${w.exists ? `${w.ab}週` : `<button class="abbtn" data-ab="${w.monday}">${w.ab}週</button>`}</td>
        <td>${w.exists ? '週案にもうあるので作りません' : ''}</td></tr>`).join('')}</table>
      ${okCount < CLASSES.length ? `<p class="ng">${CLASSES.filter((c) => !ps[c]?.ok).join('・')}の時間割がまだです。その組の教科は空のまま作ります。</p>` : ''}
      <div class="row" style="margin-top:10px"><button id="make" class="primary" ${todo.length && okCount ? '' : 'disabled'}>週案を作る（${todo.length}週）</button></div>` : ''}
    ${st.made ? `<div class="howto" style="margin-top:12px"><b>「${esc(st.made)}」を保存しました。週案への取り込み方：</b>
      <ol><li>週案のスプレッドシートで「ファイル」→「インポート」→「アップロード」で、このファイルを選ぶ</li>
      <li>「インポート場所」を<b>「新しいシートを挿入する」</b>にして「データをインポート」を押す</li></ol></div>` : ''}
  </section>`;
  bind();
}

function bind() {
  document.querySelectorAll('textarea[data-cls]').forEach((t) => t.addEventListener('input', () => {
    saved.text[t.dataset.cls] = t.value; save();
    clearTimeout(bind.t); bind.t = setTimeout(() => { const pos = t.selectionStart; render(); const n = $(`textarea[data-cls="${t.dataset.cls}"]`); n.focus(); n.setSelectionRange(pos, pos); }, 400);
  }));
  $('#copyprompt')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(imagePrompt()); toast('お願い文をコピーしました。ChatGPTに貼ってください'); } catch { toast('コピーできませんでした'); }
  });
  $('#load')?.addEventListener('click', () => loadShuan($('#url').value));
  $('#url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadShuan($('#url').value); });
  $('#editurl')?.addEventListener('click', (e) => { e.preventDefault(); st.editUrl = true; render(); });
  $('#reload')?.addEventListener('click', (e) => { e.preventDefault(); loadShuan(saved.sheetUrl); });
  $('#from')?.addEventListener('change', (e) => { st.from = e.target.value; st.abOverride = {}; render(); });
  $('#to')?.addEventListener('change', (e) => { st.to = e.target.value; render(); });
  document.querySelectorAll('[data-ab]').forEach((b) => b.addEventListener('click', () => {
    const mon = b.dataset.ab;
    for (const k of Object.keys(st.abOverride)) if (k > mon) delete st.abOverride[k];
    st.abOverride[mon] = b.textContent.startsWith('A') ? 'B' : 'A'; render();
  }));
  $('#make')?.addEventListener('click', makeFile);
}

render();
if (saved.sheetUrl) loadShuan(saved.sheetUrl, true);   // 覚えているリンクがあれば、開いたときに読み込んでおく
