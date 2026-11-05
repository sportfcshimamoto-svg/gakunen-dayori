// 教科の年間カリキュラムを「表をコピーして貼り付け」で読む。
// 学校のパソコンでファイルを選べないときのため。Word・Googleドキュメント・Excelなどで表を選んでコピーすると、
// 貼り付けたデータの中に表（HTML）が入っているので、それをWordの表と同じ形にして extractFromTables に渡す。
// マスの中の文字は変えない（段落ごとに1行。前後の空白と空の行だけ取り除く）。ブラウザで動く。
import { extractFromTables } from './curriculum.js';

const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);
const SKIP = new Set(['RT', 'RP', 'STYLE', 'SCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK']);

/** マスの中の文字を、段落ごとの行にする */
function linesOf(cell) {
  const lines = ['']; const push = () => { if (lines[lines.length - 1] !== '') lines.push(''); };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        // HTMLの書き方の都合の改行や連続した空白は、画面と同じく1つの空白にする（全角の空白はそのまま）
        lines[lines.length - 1] += n.nodeValue.replace(/[ \t\r\n\f]+/g, ' ').replace(/ /g, ' ');
      } else if (n.nodeType === 1) {
        const tag = n.tagName.toUpperCase();
        if (SKIP.has(tag)) continue;                  // ふりがな（ルビ）などは使わない
        if (/display\s*:\s*none/i.test(n.getAttribute('style') || '')) continue;
        if (tag === 'BR') { lines.push(''); continue; }
        if (tag === 'TABLE') continue;                // マスの中の表は使わない
        const block = BLOCK.has(tag);
        if (block) push();
        walk(n);
        if (block) push();
      }
    }
  };
  walk(cell);
  return lines.map((l) => l.replace(/^ +| +$/g, ''));   // 半角の空白だけ取り除く（全角は curriculum.js の cleanLines が扱う）
}

/** 表を、Wordの表と同じ形にする（縦につながったマスは、下の行に 'continue' のマスを入れる） */
function tableOf(table) {
  const rows = []; const below = [];   // below[列] = { left: 残りの行数, span }
  const trs = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
  for (const tr of trs) {
    const row = { gridBefore: 0, cells: [] };
    let col = 0;
    const fillMerged = () => {
      while (below[col] && below[col].left > 0) {
        const b = below[col]; b.left--;
        row.cells.push({ lines: [], span: b.span, vMerge: 'continue' });
        col += b.span;
      }
    };
    const tds = [...tr.children].filter((c) => /^(TD|TH)$/i.test(c.tagName));
    for (const td of tds) {
      fillMerged();
      const span = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      const rs = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      row.cells.push({ lines: linesOf(td), span, vMerge: rs > 1 ? 'restart' : null });
      if (rs > 1) below[col] = { left: rs - 1, span };
      col += span;
    }
    fillMerged();
    rows.push(row);
  }
  return rows;
}

/** 貼り付けたHTMLの中の表を取り出す（表の中の表は除く） */
export function tablesOfHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('table')].filter((t) => !t.parentElement.closest('table')).map(tableOf).filter((t) => t.length);
}

/** 貼り付けたHTMLから、教科ごと・月ごとの項目を取り出す（返す形は extractCurriculum と同じ） */
export function extractCurriculumHtml(html) {
  const tables = tablesOfHtml(html || '');
  if (!tables.length) throw new Error('貼り付けたものの中に、表が見つかりませんでした。カリキュラムの表をなぞって選び、コピーしてから貼り付けてください。');
  return extractFromTables(tables);
}
