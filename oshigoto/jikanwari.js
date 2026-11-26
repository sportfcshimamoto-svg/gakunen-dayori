// 時間割スプレッドシート自動入力（テスト版）
// 「イデア」で書き出したtxtを読み、区切り（タブ・カンマ・空白）を見つけて表にし、スプレッドシートに貼れる形（タブ区切り）でコピーする。
// txtはこのパソコンの中だけで読む。どこにも送らない・保存しない。
(() => {
  const $ = (id) => document.getElementById(id);
  const samples = []; // { name, text, enc, delim }
  let cur = -1;

  // ---- 文字コード：UTF-8（BOMあり・なし）→ だめなら Shift_JIS（Windowsのメモ帳の古い形）→ UTF-16 ----
  function decode(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(b), enc: 'UTF-16' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(b), enc: 'UTF-16' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), enc: b[0] === 0xEF ? 'UTF-8（BOMつき）' : 'UTF-8' }; }
    catch { return { text: new TextDecoder('shift_jis').decode(b), enc: 'Shift_JIS' }; }
  }

  // ---- 区切りを見つける ----
  const DELIMS = { tab: 'タブ', comma: 'カンマ', space: '空白（2つ以上・全角空白）' };
  function guessDelim(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 200);
    if (!lines.length) return 'tab';
    const score = (re) => { const n = lines.map((l) => (l.match(re) || []).length); const hit = n.filter((x) => x > 0).length; return hit / lines.length + (hit ? Math.min(...n.filter((x) => x > 0)) / 100 : 0); };
    const s = { tab: score(/\t/g), comma: score(/,/g), space: score(/ {2,}|　+/g) };
    return Object.keys(s).sort((a, b) => s[b] - s[a])[0];
  }

  // カンマ区切りは "…" の中のカンマ・改行を区切りにしない
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"' && f === '') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function parse(text, delim) {
    text = text.replace(/^﻿/, '');
    let rows;
    if (delim === 'comma') rows = parseCSV(text);
    else rows = text.split(/\r?\n/).map((l) => delim === 'tab' ? l.split('\t') : l.trim().split(/ {2,}|　+/));
    while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop(); // 最後の空の行
    return rows.map((r) => r.map((c) => c.trim()));
  }

  // ---- 読み込み ----
  function add(name, text, enc) {
    samples.push({ name, text, enc, delim: guessDelim(text) });
    cur = samples.length - 1; render();
  }
  // ---- フォルダから読む（学年だよりの写真フォルダと同じしくみ。最初の1回だけ選び、このブラウザに覚える） ----
  const DB = 'jikanwari-folder';
  const db = () => new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore('h'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const getH = async () => { try { const d = await db(); return await new Promise((res) => { const g = d.transaction('h').objectStore('h').get('root'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }); } catch { return null; } };
  const putH = async (h) => { try { const d = await db(); await new Promise((res) => { const t = d.transaction('h', 'readwrite'); t.objectStore('h').put(h, 'root'); t.oncomplete = res; t.onerror = res; }); } catch { /* 覚えられなくても今回は使える */ } };
  let folder = null;
  function folderRow() {
    $('folderRow').innerHTML = folder
      ? `<button id="fload" class="primary">フォルダのtxtを読む</button><button id="fpick">フォルダを選び直す</button><span class="help">読むフォルダ：「${esc(folder.name)}」</span>`
      : '<button id="fpick" class="primary">フォルダを選ぶ（最初の1回）</button>';
    $('fpick').onclick = pickFolder; if ($('fload')) $('fload').onclick = loadFolder;
  }
  async function pickFolder() {
    if (!window.showDirectoryPicker) { toast('このブラウザではフォルダを選べません（Edge か Chrome で開いてください）。コピーして貼ってください'); return; }
    try { folder = await window.showDirectoryPicker({ id: 'jikanwari', mode: 'read' }); }
    catch (e) { if (!(e && e.name === 'AbortError')) toast(`フォルダを選べませんでした（${e && e.name || e}）`); return; }
    await putH(folder); folderRow(); await loadFolder();
  }
  async function loadFolder() {
    if (!folder) return;
    try { if ((await folder.queryPermission({ mode: 'read' })) !== 'granted' && (await folder.requestPermission({ mode: 'read' })) !== 'granted') { toast('フォルダを見る許可がもらえませんでした。もう一度押して「許可」を選んでください'); return; } } catch { /* そのまま読んでみる */ }
    try {
      const hs = [];
      for await (const h of folder.values()) if (h.kind === 'file' && /\.(txt|csv|tsv)$/i.test(h.name)) hs.push(h);
      hs.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
      if (!hs.length) { toast(`「${folder.name}」の中にtxtがありません`); return; }
      let n = 0;
      for (const h of hs) {
        try {
          const { text, enc } = decode(await (await h.getFile()).arrayBuffer());
          const old = samples.findIndex((s) => s.name === h.name); // 同じ名前は読みなおし
          const item = { name: h.name, text, enc, delim: guessDelim(text) };
          if (old >= 0) samples[old] = item; else samples.push(item);
          n++;
        } catch { toast(h.name + ' が読めませんでした。中身をコピーして貼ってください'); }
      }
      if (n) { cur = samples.findIndex((s) => s.name === hs[0].name); render(); toast(`${n}このtxtを読みました`); }
    } catch (e) { toast(`フォルダを読めませんでした（${e && e.name || e}）。コピーして貼ってください`); }
  }
  getH().then((h) => { folder = h; folderRow(); });
  $('addPaste').addEventListener('click', () => {
    const t = $('paste').value;
    if (!t.trim()) { toast('欄が空です。txtの中身を貼ってください'); return; }
    add($('pname').value.trim() || `貼りつけ${samples.length + 1}`, t, '貼りつけ');
    $('paste').value = ''; $('pname').value = '';
  });

  // ---- 表示 ----
  const DAYS = /^(月|火|水|木|金|土|日)(曜日?)?$/;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };

  function render() {
    const on = cur >= 0;
    $('s2').classList.toggle('off', !on); $('s3').classList.toggle('off', !on); $('copy').disabled = !on;
    $('samples').innerHTML = samples.map((s, i) => `<button data-i="${i}" class="${i === cur ? 'on' : ''}">${esc(s.name)}<span class="x" data-del="${i}" title="外す">×</span></button>`).join('');
    if (!on) { $('result').innerHTML = '<p class="help">まだ読み込んでいません。</p>'; return; }
    const s = samples[cur], rows = parse(s.text, s.delim);
    const cols = Math.max(0, ...rows.map((r) => r.length));
    const days = rows.flat().filter((c) => DAYS.test(c)).length;
    const MAX = 300;
    const head = `<tr><th></th>${Array.from({ length: cols }, (_, i) => `<th>${colName(i)}</th>`).join('')}</tr>`;
    const body = rows.slice(0, MAX).map((r, ri) => `<tr><th>${ri + 1}</th>${Array.from({ length: cols }, (_, ci) => { const c = r[ci] ?? ''; return `<td class="${!c ? 'empty' : DAYS.test(c) ? 'day' : ''}">${esc(c)}</td>`; }).join('')}</tr>`).join('');
    $('result').innerHTML = `
      <dl class="info">
        <dt>ファイル</dt><dd>${esc(s.name)}</dd>
        <dt>文字コード</dt><dd>${esc(s.enc)}</dd>
        <dt>区切り</dt><dd><select id="delim">${Object.entries(DELIMS).map(([k, v]) => `<option value="${k}"${k === s.delim ? ' selected' : ''}>${v}</option>`).join('')}</select> <span class="help">（自動で見つけた形。ちがうときは選びなおす）</span></dd>
        <dt>大きさ</dt><dd>${rows.length}行 × ${cols}列${days ? `　曜日のマス ${days}こ（青）` : ''}</dd>
      </dl>
      <div class="tablewrap"><table class="raw"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      ${rows.length > MAX ? `<p class="help">はじめの${MAX}行だけ出しています（コピーは全部の行）。</p>` : ''}
      <details><summary>txtの中身をそのまま見る</summary><pre class="text">${esc(s.text)}</pre></details>`;
    $('delim').addEventListener('change', (e) => { s.delim = e.target.value; render(); });
  }
  $('samples').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { samples.splice(+del.dataset.del, 1); cur = Math.min(cur, samples.length - 1); render(); return; }
    const b = e.target.closest('[data-i]'); if (b) { cur = +b.dataset.i; render(); }
  });

  // ---- コピー（タブ区切り＝スプレッドシートにそのまま貼れる形） ----
  $('copy').addEventListener('click', async () => {
    const s = samples[cur]; if (!s) return;
    const tsv = parse(s.text, s.delim).map((r) => r.map((c) => /[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join('\t')).join('\n');
    try { await navigator.clipboard.writeText(tsv); $('msg').textContent = 'コピーしました。スプレッドシートのA1で Ctrl + V'; }
    catch { $('msg').textContent = 'コピーできませんでした。もう一度押してください'; }
  });

  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 3500); }
  render();
})();
