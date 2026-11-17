// 週案に入れるプログラム（shuan-menu.gs.txt）を読み込んで、ボタンでコピーできるようにする
(async () => {
  const btn = document.getElementById('copy'), msg = document.getElementById('msg');
  let code = '';
  try {
    const r = await fetch('shuan-menu.gs.txt', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    code = await r.text();
    btn.disabled = false; btn.textContent = 'プログラムをコピー';
  } catch {
    btn.textContent = '読み込めませんでした'; msg.textContent = 'ページを読み込みなおしてください';
  }
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); msg.textContent = 'コピーしました。次の「週案に貼る」へ進んでください'; }
    catch { msg.textContent = 'コピーできませんでした。もう一度押してください'; }
  });
})();
