// トップページ：タイルを選んだら、カスタネットの音（カン・カン）を鳴らしてから開く。
// 左上のロゴのカスタネットを押しても鳴る。絵は音に合わせて閉じたり開いたりする。
// 音のファイルは使わず、ブラウザの中で音を作る（外に接続しない）。音が出せないときは、そのまま開く。
//
// 音の作り方（打楽器の音を作るプロのやり方）：
//  ・前の版は、きれいな音（正弦波）が長く鳴っていたので「びん」のようになった。
//    本物のカスタネットは、乾いた木やプラスチックの殻がぶつかる音なので、
//    「鳴り」よりも「当たる音（雑音）」が主役で、響きはとても短い（20〜30ミリ秒くらいで消える）
//  ・そこで、短い雑音を、殻の中の空洞の響き（1.9k・3k・4.5kHzあたり）だけ通して「カッ」を作り、
//    ほんの少しだけ音の芯（すぐ消える低めの鳴り）を足して「カン」に近づける
//  ・2枚の殻はほんの少しずれて当たる → 音に厚みが出る。毎回ほんの少しだけ高さを変えて、機械っぽさをなくす
(() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, out = null;

  function setup() {
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); // 音が割れないように軽く押さえる
    comp.threshold.value = -8; comp.ratio.value = 3; comp.attack.value = 0.0005; comp.release.value = 0.05;
    out = ctx.createGain(); out.gain.value = 1.5;
    out.connect(comp).connect(ctx.destination);
  }

  // 短い雑音（打つ音のもと）。ms：長さ
  function noise(ms) {
    const len = Math.floor(ctx.sampleRate * ms / 1000);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
    const src = ctx.createBufferSource(); src.buffer = buf;
    return src;
  }

  // 殻1枚が当たる音
  function shell(t, vol, p) {
    const src = noise(25);
    // 空洞の響き：あまりとがらせない（Q を低めに）→ 鳴りが長く残らない
    for (const [f, q, g] of [[1900, 6, 1.0], [3000, 7, 0.8], [4500, 5, 0.5]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * p; bp.Q.value = q;
      const gn = ctx.createGain(); gn.gain.value = g * vol * 2.2;
      src.connect(bp).connect(gn).connect(out);
    }
    // 当たった瞬間の「カ」（高い音だけ）
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;
    const hg = ctx.createGain(); hg.gain.value = vol * 0.6;
    src.connect(hp).connect(hg).connect(out);
    src.start(t);
    // 音の芯（すぐ消える。長く鳴らすと「びん」になるので 15 ミリ秒ほどで消す）
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1750 * p;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.04);
  }

  // 「カン」1回：2枚の殻が少しずれて当たる
  function kan(t, vol) {
    const p = 0.97 + Math.random() * 0.06;
    shell(t, vol * 0.7, p * 1.05);
    shell(t + 0.003, vol, p);
  }

  const art = document.querySelector('.clapper');
  function animate() {
    if (!art) return;
    art.classList.remove('clap'); void art.offsetWidth; art.classList.add('clap');
  }

  function castanet() {
    animate();
    if (!AC) return false;
    try {
      if (!ctx) setup();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + 0.015;
      kan(t, 0.85);         // カン
      kan(t + 0.17, 0.6);   // カン
      endAt = t + 0.17 + 0.05; // 2回目の「カン」が消えるころ
      return true;
    } catch (e) { return false; }
  }

  // 2回目の「カン」が本当に鳴り終わってからページを開く。
  // パソコンによっては音がスピーカーに届くまで少し遅れる（outputLatency）ので、その分も待つ。
  // 前は 0.33 秒で決めうちしていたため、2回目が鳴る前にページが切りかわることがあった。
  let endAt = 0;
  function afterSound(go) {
    const lag = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + 0.06;
    const started = performance.now();
    (function wait() {
      if (ctx.currentTime >= endAt + lag || performance.now() - started > 1500) go();
      else setTimeout(wait, 20);
    })();
  }

  if (art) art.addEventListener('click', castanet);

  document.querySelectorAll('a.tile').forEach((a) => {
    a.addEventListener('click', (ev) => {
      // 新しいタブで開くとき（Ctrl・中ボタンなど）は、音だけ鳴らしてふつうに開く
      if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) { castanet(); return; }
      if (!castanet()) return;
      ev.preventDefault();
      afterSound(() => { location.href = a.href; }); // 音が鳴り終わってからページを開く
    });
  });
})();
