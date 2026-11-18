// 授業時数表への反映：画面の動き
// すべてこのブラウザの中で処理する（Excelファイルをインターネットに送らない）。
import { openBook, readJisuSheet, readShuan, planWeek, writeJisu, DAYS, SLOTS } from './jisu-core.js';

const KEY = 'gakunen-jimu:jisu:v1';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 覚えておくこと（このブラウザだけ）：週案のリンク、書き込むタブの名前、組、自分で決めた読みかえ
const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
saved.custom ||= {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 覚えられなくても使える */ } };

const st = {
  shuanBook: null, shuanAt: '', weeks: [], skipped: [],
  jisuBook: null, jisuName: '', cands: [], target: '', className: '',
  picked: new Set(), loading: false,
  copyT: null, copied: false,   // コピーで入れるときの「時数表の形」（ファイルを読まずに、ふつうの授業時数算出シートの形を使う）
};
// 入れ方：'copy' = コピーして時数表に貼る（学校のパソコンはファイルを選べないので、こちらがふつう）／'file' = Excelファイルを選ぶ
const mode = () => (saved.mode === 'file' ? 'file' : 'copy');

// ふつうの授業時数算出シートの形：月〜金それぞれ「モジュール＋1〜6校時」が L列〜AT列 に続けて並ぶ
const COLS = 'L M N O P Q R S T U V W X Y Z AA AB AC AD AE AF AG AH AI AJ AK AL AM AN AO AP AQ AR AS AT'.split(' ');
const OPTIONS = ['国', '社', '算', '理', '生', '音', '図', '家', '体', '外', '道', '特', '総', '児', 'ク', '行'];
function makeCopyTarget() {
  const days = DAYS.map((_, i) => ({ module: COLS[i * 7], periods: COLS.slice(i * 7 + 1, i * 7 + 7) }));
  const weeks = new Map(st.weeks.map((w, i) => [w.monday, { row: i + 1, label: `${md(w.monday)}の週` }]));
  return { sheet: { name: '', cells: new Map() }, info: { ok: true, year: schoolYear(), days, weeks, options: OPTIONS } };
}

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const schoolYear = () => {
  const c = mode() === 'file' && (st.cands.find((x) => x.sheet.name === st.target) || st.cands[0]);
  if (c) return c.info.year;
  const d = new Date(); return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
};
const targetOf = () => (mode() === 'copy' ? st.copyT : st.cands.find((x) => x.sheet.name === st.target) || null);
const md = (isoDate) => { const [, m, d] = isoDate.split('-').map(Number); return `${m}月${d}日`; };

// ---------- 読み込み ----------
const sheetIdOf = (url) => { const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : null; };
async function loadShuan(url) {
  const id = sheetIdOf(url);
  if (!id) { toast('Googleスプレッドシートのリンクではないようです。共有のリンク（https://docs.google.com/spreadsheets/d/…）を貼ってください'); return; }
  st.loading = true; render(); toast('週案を読み込んでいます…');
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('not xlsx');
    st.shuanBook = await openBook(bytes);
    st.shuanAt = new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    saved.sheetUrl = String(url).trim(); save();
    reparse();
    toast(`週案を読み込みました（${st.weeks.length}週分）`);
  } catch {
    toast('週案を読み込めませんでした。共有の設定が「リンクを知っている全員」になっているか、インターネットにつながっているかを確かめてください', 8000);
  }
  st.loading = false; render();
}

async function loadJisu(file) {
  try {
    const book = await openBook(new Uint8Array(await file.arrayBuffer()));
    const cands = [];
    for (const sheet of book.sheets) {
      const info = readJisuSheet(sheet, schoolYear());
      if (info.ok) cands.push({ sheet, info });
    }
    if (!cands.length) { toast('このExcelの中に、授業時数表の形のタブが見つかりませんでした。ファイルを確かめてください', 8000); return; }
    st.jisuBook = book; st.jisuName = file.name; st.cands = cands;
    // 書き込むタブ：前に選んだ名前があればそれ。タブが1つならそれ。2つ以上なら選んでもらう
    st.target = cands.some((c) => c.sheet.name === saved.target) ? saved.target : cands.length === 1 ? cands[0].sheet.name : '';
    const m = /\d\s*[-ー－]\s*(\d)/.exec(file.name.normalize('NFKC'));
    if (m && !st.className) st.className = `${m[1]}組`;
    reparse();
    toast('授業時数表を読み込みました');
  } catch (e) {
    toast('Excelファイルを読み込めませんでした（' + (e.message || e) + '）', 8000);
  }
  render();
}

function reparse() {
  if (!st.shuanBook) return;
  const r = readShuan(st.shuanBook, schoolYear());
  st.weeks = r.weeks; st.skipped = r.skipped;
  st.copyT = makeCopyTarget();
  const classes = [...new Set(st.weeks.flatMap((w) => Object.keys(w.classes)))];
  if (!classes.includes(st.className)) st.className = classes.includes(saved.className) ? saved.className : classes[0] || '';
  // はじめは、時数表に週があるものをすべて選んでおく
  const t = targetOf();
  st.picked = new Set(st.weeks.filter((w) => !t || t.info.weeks.has(w.monday)).map((w) => w.monday));
}

// ---------- 予定づくり ----------
function plans() {
  const t = targetOf();
  if (!t || !st.weeks.length || !st.className) return [];
  return st.weeks.filter((w) => st.picked.has(w.monday) && t.info.weeks.has(w.monday)).map((w) => {
    const { row, label } = t.info.weeks.get(w.monday);
    return { week: w, row, label, cells: planWeek(w, st.className, t.info, row, t.sheet, saved.custom) };
  });
}

async function apply() {
  const t = targetOf(); const ps = plans();
  const values = {};
  for (const p of ps) for (const c of p.cells) {
    if (c.status === 'unknown') { toast('赤いマスがまだ残っています。教科を選んでください'); return; }
    values[c.ref] = c.code || null;
  }
  try {
    const bytes = await writeJisu(st.jisuBook, t.sheet.name, values);
    const base = st.jisuName.replace(/\.xlsx$/i, '');
    const d = new Date();
    const name = `${base}（週案反映${d.getMonth() + 1}月${d.getDate()}日）.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast(`「${name}」を保存しました。元のファイルはそのまま残っています`, 9000);
  } catch (e) {
    toast('Excelに書き込めませんでした（' + (e.message || e) + '）', 8000);
  }
}

// ---------- コピーして貼る（ファイルを選ばない） ----------
// 授業時数算出シートは、夏休み・冬休みも含めて「1週 = 1行」でカレンダーどおりに並んでいる。
// だから、選んだ最初の週から最後の週までを、とんでいる週は空の行にして1回でコピーすれば、1回の Ctrl+V で全部入る。
const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function copyBlock(ps) {
  const sorted = [...ps].sort((a, b) => a.week.monday.localeCompare(b.week.monday));
  const by = new Map(sorted.map((p) => [p.week.monday, p]));
  const lines = []; const blanks = [];
  if (!sorted.length) return { lines, blanks, first: '', last: '' };
  const first = sorted[0].week.monday, last = sorted.at(-1).week.monday;
  for (let m = first; m <= last; m = addDays(m, 7)) {
    const p = by.get(m);
    if (p) lines.push(DAYS.flatMap((d) => SLOTS.map((s) => p.cells.find((c) => c.day === d && c.slot === s).code || '')).join('\t'));
    else { lines.push(new Array(DAYS.length * SLOTS.length).fill('').join('\t')); blanks.push(m); }
  }
  return { lines, blanks, first, last };
}
// 空にする週を「7月20日〜8月17日の週」のように続いたかたまりで言う
function blankSpans(blanks) {
  const out = [];
  for (const m of blanks) { const l = out.at(-1); if (l && addDays(l[1], 7) === m) l[1] = m; else out.push([m, m]); }
  return out.map(([a, b]) => (a === b ? `${md(a)}の週` : `${md(a)}〜${md(b)}の週`));
}

async function copyAll() {
  const ps = plans();
  if (!ps.length) return;
  if (ps.some((p) => p.cells.some((c) => c.status === 'unknown'))) { toast('赤いマスがまだ残っています。下の表で教科を選んでください'); return; }
  const { lines, first } = copyBlock(ps);
  const text = lines.join('\r\n');
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* 下のやり方でためす */ }
  if (!ok) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  st.copied = ok;
  toast(ok ? `コピーしました。Excelで「${md(first)}の週」の行の、月曜日「モジュール」のマスをクリックして、Ctrl + V で貼ってください` : 'コピーできませんでした。もう一度ボタンを押してください', ok ? 12000 : 6000);
  render();
}

// ---------- 画面 ----------
function render() {
  const t = targetOf();
  const ready1 = !!st.shuanBook, ready2 = !!t;
  const classes = [...new Set(st.weeks.flatMap((w) => Object.keys(w.classes)))];
  const ps = ready1 && ready2 ? plans() : [];
  const unknown = ps.reduce((n, p) => n + p.cells.filter((c) => c.status === 'unknown').length, 0);
  const total = ps.reduce((n, p) => n + p.cells.length, 0);

  $('#main').innerHTML = `
  <section class="step">
    <h2><span class="num">1</span>週案を読み込む</h2>
    <div class="row">
      <input id="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(saved.sheetUrl || '')}">
      <button id="load" class="primary" ${st.loading ? 'disabled' : ''}>読み込む</button>
    </div>
    <p class="help">週案のGoogleスプレッドシートのリンクを貼ります。共有は「リンクを知っている全員（閲覧者）」にしておきます。リンクはこのパソコンに覚えておきます。</p>
    ${ready1 ? `<p class="ok">✓ ${st.weeks.length}週分を読み込みました（${esc(st.shuanAt)}）</p>
      ${quickHtml(ps, unknown)}
      ${st.skipped.length ? `<details><summary>読まなかったタブ（${st.skipped.length}こ）</summary><ul>${st.skipped.map((s) => `<li>${esc(s.name)}：${esc(s.reason)}</li>`).join('')}</ul></details>` : ''}` : ''}
  </section>

  <section class="step">
    <h2><span class="num">2</span>授業時数表への入れ方を選ぶ</h2>
    <div class="row">
      <label><input type="radio" name="mode" value="copy" ${mode() === 'copy' ? 'checked' : ''}> コピーして時数表に貼る（学校のパソコンはこちら）</label>
      <label><input type="radio" name="mode" value="file" ${mode() === 'file' ? 'checked' : ''}> Excelファイルを選ぶ</label>
    </div>
    ${mode() === 'copy' ? `<p class="help">ファイルを選ばずに使えます。最後に「コピー」ボタンを押して、学校の時数表（Excel）に自分で貼ります。色・プルダウン・集計の式はそのまま残ります。</p>` : `
    <div class="row" style="margin-top:8px"><label class="btn">Excelファイルを選ぶ<input id="file" type="file" accept=".xlsx" hidden></label>
      ${st.jisuName ? `<span>${esc(st.jisuName)}</span>` : ''}</div>
    <p class="help">学校のパソコンで「このサイトへのアップロードは許可されていません」と出るときは、上の「コピーして時数表に貼る」を使ってください。</p>`}
    ${mode() === 'file' && st.cands.length ? `
      <div class="row" style="margin-top:8px">書き込むタブ：
        <select id="target">
          ${st.target ? '' : '<option value="">選んでください</option>'}
          ${st.cands.map((c) => `<option ${c.sheet.name === st.target ? 'selected' : ''}>${esc(c.sheet.name)}</option>`).join('')}
        </select></div>
      <p class="help">表の形（「モジュール」と1〜6校時、「第○週」）で授業時数表のタブを見つけています。タブの名前が変わっても使えます。選んだタブはこのパソコンに覚えておきます。</p>` : ''}
  </section>

  <section class="step ${ready1 && ready2 ? '' : 'off'}">
    <h2><span class="num">3</span>組と週を選ぶ</h2>
    ${ready1 && ready2 ? `
    <div class="row">組：${classes.map((c) => `<label><input type="radio" name="cls" value="${esc(c)}" ${c === st.className ? 'checked' : ''}> ${esc(c)}</label>`).join(' ')}</div>
    <div class="row" style="margin:8px 0"><button id="all">すべて選ぶ</button><button id="none">すべて外す</button></div>
    ${mode() === 'copy' ? `<table class="weeks"><tr><th></th><th>週案のタブ</th><th>週</th><th>A/B</th></tr>
    ${st.weeks.map((w) => `<tr><td><input type="checkbox" data-week="${w.monday}" ${st.picked.has(w.monday) ? 'checked' : ''}></td>
        <td>${esc(w.name)}</td><td>${md(w.monday)}〜</td><td>${w.ab ? w.ab + '週' : '―'}</td></tr>`).join('')}
    </table>` : `
    <table class="weeks"><tr><th></th><th>週案のタブ</th><th>週</th><th>A/B</th><th>時数表</th><th>いまの時数表</th></tr>
    ${st.weeks.map((w) => {
      const hit = t.info.weeks.get(w.monday);
      const filled = hit ? Object.values(planWeek(w, st.className, t.info, hit.row, t.sheet, saved.custom)).filter((c) => c.now).length : 0;
      return `<tr class="${hit ? '' : 'dis'}"><td><input type="checkbox" data-week="${w.monday}" ${hit ? '' : 'disabled'} ${hit && st.picked.has(w.monday) ? 'checked' : ''}></td>
        <td>${esc(w.name)}</td><td>${md(w.monday)}〜</td><td>${w.ab ? w.ab + '週' : '―'}</td>
        <td>${hit ? esc(hit.label) : '時数表にこの週がありません'}</td>
        <td>${!hit ? '' : filled ? `<span class="tag over">入力済み（${filled}マス）→ 上書き</span>` : '<span class="tag">空</span>'}</td></tr>`;
    }).join('')}
    </table>`}` : `<p class="help">${mode() === 'copy' ? '1で週案を読み込むと選べます。' : '1と2が終わると選べます。'}</p>`}
  </section>

  <section class="step ${ps.length ? '' : 'off'}">
    <h2><span class="num">4</span>入る文字を確かめる</h2>
    ${ps.length ? `
    <p class="help">大きい字が時数表に入る文字、小さい字が週案に書いてあることばです。「→」があるときは変更後（右側）を使います。</p>
    <p class="legend">${mode() === 'file' ? '<span style="background:var(--new)">いまの時数表と変わる</span>' : ''}<span style="background:var(--warn)">A週/B週で決めた（念のため確認）</span><span style="background:var(--bad)">教科が分からない（選んでください）</span></p>
    ${ps.map(gridHtml).join('')}` : '<p class="help">3で週を選ぶと、ここに出ます。</p>'}
  </section>
  ${ps.length && mode() === 'copy' ? copyHtml(ps) : ''}
  ${ps.length && mode() === 'file' ? `<div class="final">
    <button id="apply" class="primary" ${unknown ? 'disabled' : ''}>Excelに反映して保存</button>
    <span>${ps.length}週・${total}マス。${unknown ? `<span class="ng">赤いマスがあと${unknown}こあります</span>` : '新しいファイルとして保存します（元のファイルは変えません）。'}</span>
  </div>` : ''}`;
  bind();
}

function gridHtml(p) {
  const opts = targetOf().info.options;
  const cell = (c) => {
    if (c.status === 'unknown') {
      return `<td class="unknown"><select data-word="${esc(c.word)}"><option value="">選ぶ</option>${opts.map((o) => `<option>${esc(o)}</option>`).join('')}<option value="-">入れない</option></select><span class="raw" title="${esc(c.raw)}">${esc(c.raw)}</span></td>`;
    }
    const cls = c.status === 'ab' ? 'ab' : mode() === 'file' && (c.code || '') !== (c.now || '') ? 'chg' : '';
    const title = `週案：${c.raw || '（空）'}　いまの時数表：${c.now || '（空）'}`;
    return `<td class="${cls}" title="${esc(title)}"><span class="code">${esc(c.code) || '&nbsp;'}</span><span class="raw">${esc(c.raw)}</span></td>`;
  };
  const rows = SLOTS.map((s) => `<tr><th>${s === '朝' ? '朝学<br><small>(モジュール)</small>' : s + '校時'}</th>${DAYS.map((d) => cell(p.cells.find((c) => c.day === d && c.slot === s))).join('')}</tr>`).join('');
  return `<div class="week"><h3>${esc(p.label)}（${md(p.week.monday)}〜・${p.week.ab ? p.week.ab + '週' : 'A/Bなし'}・週案のタブ「${esc(p.week.name)}」）</h3>
    <table class="grid"><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>${rows}</table></div>`;
}

function copyBtn(unknown) {
  return unknown ? `<span class="ng">赤いマスがあと${unknown}こ（下の4で教科を選んでください）</span>`
    : `<button class="primary big" data-copyall>${st.copied ? 'もう一度コピー' : '時数表用にコピー'}</button>${st.copied ? ' <span class="ok">✓ コピーしました</span>' : ''}`;
}
// 読み込めたら、いちばん上ですぐコピーできるようにする（ふだんはここだけで終わる）
function quickHtml(ps, unknown) {
  if (mode() !== 'copy' || !ps.length) return '';
  const { first, last } = copyBlock(ps);
  return `<div class="quick">
    <div class="row">${copyBtn(unknown)}</div>
    <p class="help">${esc(st.className)}・${md(first)}の週 〜 ${md(last)}の週。コピーしたら、Excelの「実施計画」で <b>${md(first)}の週</b> の行の、<b>月曜日の「モジュール」</b>のマスをクリックして <b>Ctrl + V</b>。</p>
  </div>`;
}

function copyHtml(ps) {
  const unknown = ps.reduce((n, p) => n + p.cells.filter((c) => c.status === 'unknown').length, 0);
  const { lines, blanks, first, last } = copyBlock(ps);
  const spans = blankSpans(blanks);
  return `<section class="step">
    <h2><span class="num">5</span>コピーして、時数表に貼る</h2>
    <ol class="help copyhow">
      <li>学校の授業時数算出シート（Excel）を開き、書きこむタブ（「実施計画」）を出しておきます。</li>
      <li>下の「時数表用にコピー」を押します。</li>
      <li>Excelで、<b>${md(first)}の週の行</b>（左の小さなカレンダーの日付で見つけます）の、<b>月曜日の「モジュール」のマス</b>（ふつうはL列）をクリックして、<b>Ctrl + V</b> で貼ります。これで ${md(last)}の週まで、1回で全部入ります。</li>
    </ol>
    <div class="row">${copyBtn(unknown)}</div>
    <p class="help">${lines.length}行（${md(first)}の週 〜 ${md(last)}の週）。${spans.length ? `週案にない週（${spans.map(esc).join('・')}）は、空のまま貼ります。夏休み・冬休みの行はもともと空なので、そのままで大丈夫です。` : ''}</p>
    <p class="help">貼ったあと、Excelで月曜日の朝学や1校時の文字が、上の表と同じになっているか見てください。まちがえたときは、Excelで Ctrl + Z を押すと元にもどります。</p>
  </section>`;
}

function bind() {
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { saved.mode = r.value; save(); st.copied = false; reparse(); render(); }));
  document.querySelectorAll('button[data-copyall]').forEach((b) => b.addEventListener('click', copyAll));
  $('#load')?.addEventListener('click', () => loadShuan($('#url').value));
  $('#url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadShuan($('#url').value); });
  $('#file')?.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadJisu(f); });
  $('#target')?.addEventListener('change', (e) => { st.target = e.target.value; saved.target = st.target; save(); reparse(); render(); });
  document.querySelectorAll('input[name=cls]').forEach((r) => r.addEventListener('change', () => { st.className = r.value; saved.className = r.value; save(); render(); }));
  $('#all')?.addEventListener('click', () => { const t = targetOf(); st.picked = new Set(st.weeks.filter((w) => t.info.weeks.has(w.monday)).map((w) => w.monday)); render(); });
  $('#none')?.addEventListener('click', () => { st.picked = new Set(); render(); });
  document.querySelectorAll('input[data-week]').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) st.picked.add(c.dataset.week); else st.picked.delete(c.dataset.week);
    render();
  }));
  // 分からなかったことばを選ぶと、次からも同じように読む（このパソコンに覚える）
  document.querySelectorAll('select[data-word]').forEach((s) => s.addEventListener('change', () => {
    if (!s.value) return;
    saved.custom[s.dataset.word] = s.value === '-' ? '' : s.value; save(); render();
  }));
  $('#apply')?.addEventListener('click', apply);
}

render();
// 前に読み込んだ週案があれば、ページを開いたときに自動で読み込む（ボタンを押さなくてよい）
if (saved.sheetUrl) loadShuan(saved.sheetUrl);
