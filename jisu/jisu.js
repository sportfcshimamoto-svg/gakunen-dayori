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
};

function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
const schoolYear = () => {
  const c = st.cands.find((x) => x.sheet.name === st.target) || st.cands[0];
  if (c) return c.info.year;
  const d = new Date(); return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
};
const targetOf = () => st.cands.find((x) => x.sheet.name === st.target) || null;
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
      ${st.skipped.length ? `<details><summary>読まなかったタブ（${st.skipped.length}こ）</summary><ul>${st.skipped.map((s) => `<li>${esc(s.name)}：${esc(s.reason)}</li>`).join('')}</ul></details>` : ''}` : ''}
  </section>

  <section class="step">
    <h2><span class="num">2</span>授業時数表（Excel）を選ぶ</h2>
    <div class="row"><label class="btn">Excelファイルを選ぶ<input id="file" type="file" accept=".xlsx" hidden></label>
      ${st.jisuName ? `<span>${esc(st.jisuName)}</span>` : ''}</div>
    ${st.cands.length ? `
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
    <table class="weeks"><tr><th></th><th>週案のタブ</th><th>週</th><th>A/B</th><th>時数表</th><th>いまの時数表</th></tr>
    ${st.weeks.map((w) => {
      const hit = t.info.weeks.get(w.monday);
      const filled = hit ? Object.values(planWeek(w, st.className, t.info, hit.row, t.sheet, saved.custom)).filter((c) => c.now).length : 0;
      return `<tr class="${hit ? '' : 'dis'}"><td><input type="checkbox" data-week="${w.monday}" ${hit ? '' : 'disabled'} ${hit && st.picked.has(w.monday) ? 'checked' : ''}></td>
        <td>${esc(w.name)}</td><td>${md(w.monday)}〜</td><td>${w.ab ? w.ab + '週' : '―'}</td>
        <td>${hit ? esc(hit.label) : '時数表にこの週がありません'}</td>
        <td>${!hit ? '' : filled ? `<span class="tag over">入力済み（${filled}マス）→ 上書き</span>` : '<span class="tag">空</span>'}</td></tr>`;
    }).join('')}
    </table>` : '<p class="help">1と2が終わると選べます。</p>'}
  </section>

  <section class="step ${ps.length ? '' : 'off'}">
    <h2><span class="num">4</span>入る文字を確かめる</h2>
    ${ps.length ? `
    <p class="help">大きい字が時数表に入る文字、小さい字が週案に書いてあることばです。「→」があるときは変更後（右側）を使います。</p>
    <p class="legend"><span style="background:var(--new)">いまの時数表と変わる</span><span style="background:var(--warn)">A週/B週で決めた（念のため確認）</span><span style="background:var(--bad)">教科が分からない（選んでください）</span></p>
    ${ps.map(gridHtml).join('')}` : '<p class="help">3で週を選ぶと、ここに出ます。</p>'}
  </section>
  ${ps.length ? `<div class="final">
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
    const cls = c.status === 'ab' ? 'ab' : (c.code || '') !== (c.now || '') ? 'chg' : '';
    const title = `週案：${c.raw || '（空）'}　いまの時数表：${c.now || '（空）'}`;
    return `<td class="${cls}" title="${esc(title)}"><span class="code">${esc(c.code) || '&nbsp;'}</span><span class="raw">${esc(c.raw)}</span></td>`;
  };
  const rows = SLOTS.map((s) => `<tr><th>${s === '朝' ? '朝学<br><small>(モジュール)</small>' : s + '校時'}</th>${DAYS.map((d) => cell(p.cells.find((c) => c.day === d && c.slot === s))).join('')}</tr>`).join('');
  return `<div class="week"><h3>${esc(p.label)}（${md(p.week.monday)}〜・${p.week.ab ? p.week.ab + '週' : 'A/Bなし'}・週案のタブ「${esc(p.week.name)}」）</h3>
    <table class="grid"><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>${rows}</table></div>`;
}

function bind() {
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
