// AI（ChatGPT・Claudeなど）に渡す「お願いの文」を作り、返ってきた文章を学年だより用に整える。
// アプリはAIを直接呼ばない。先生がお願いの文をコピーしてAIの画面に貼り付け、返事をアプリに貼り付けて戻す。
// AIに渡すのは、学年・月・行事予定・見出し・先生のメモだけ（写真や子どもの名前は入れない）。

const KINDS = {
  activity: { label: '活動の紹介', aim: '子どもたちががんばっていた様子や、学んだことが保護者に伝わるように書く' },
  notice: { label: 'お知らせ', aim: '保護者に伝えたいこと・お願いしたいことが、はっきり分かるように書く。日時・持ち物・数字は、メモのとおり正確に書く' },
};
export const SECTION_KINDS = Object.keys(KINDS).map((k) => ({ value: k, label: KINDS[k].label }));

/** 1行に入るおよその文字数（本文の幅18.46cm） */
export const charsPerLine = (pt) => Math.floor(18.46 / (pt * 0.03528));

const COMMON = [
  'です・ます調で、ていねいでやわらかい文にする（保護者向け）',
  '「先生のメモ」と、ここに書いた情報にあることだけを使う。書かれていない出来事・日付・数字・人の名前は、想像で書き足さない',
  '子どもの名前は書かない',
  '本文だけを書く。タイトル・見出し・前置き・説明・記号（「#」「*」「・」など）はつけない。段落の間は改行で区切る',
];
const memoBlock = (memo) => (memo && memo.trim() ? memo.trim() : '（なし）');
const conditions = (list) => list.map((s) => `- ${s}`).join('\n');

/**
 * はじめのあいさつのお願いの文
 * @param ctx { grade, month, events: [{day, weekday, text}], memo, lines }
 */
export function greetingPrompt({ grade, month, events = [], memo = '', lines = 8 }) {
  const chars = lines * charsPerLine(10.5);
  const paras = Math.max(2, Math.min(5, Math.round(lines / 3)));
  const ev = events.length ? events.map((e) => `- ${e.day}日（${e.weekday}）${e.text}`).join('\n') : '（なし）';
  return `あなたは小学校の先生です。保護者向けの「学年だより」（${grade}年生・${month}月号）の、はじめのあいさつの文章を書いてください。

【条件】
${conditions([
    `${month}月らしい季節のあいさつから始め、今月の学年の様子や見通しにふれ、最後に保護者へのお礼やお願いで結ぶ`,
    `全体で約${chars}字（${paras}段落くらい）。1段落は2〜4文`,
    '行事は、下の「今月の行事」から大事なものを2〜3つ選んでふれる程度にする（全部を並べない）',
    ...COMMON,
  ])}

【今月の行事】（学年だよりの1ページ目に、別に一覧でのせます）
${ev}

【先生のメモ】
${memoBlock(memo)}`;
}

/**
 * 2ページ目の記事の本文のお願いの文
 * @param ctx { grade, month, title, kind: 'activity'|'notice', memo, draft: [段落], lines, fontSize }
 */
export function sectionPrompt({ grade, month, title, kind = 'activity', memo = '', draft = [], lines = 4, fontSize = 11 }) {
  const k = KINDS[kind] || KINDS.activity;
  const chars = lines * charsPerLine(fontSize);
  const hasDraft = draft.some((p) => p.trim());
  return `あなたは小学校の先生です。保護者向けの「学年だより」（${grade}年生・${month}月号）の2ページ目にのせる記事の本文を書いてください。

【記事の見出し】${title || '（なし）'}
【記事の種類】${k.label}

【条件】
${conditions([
    k.aim,
    `全体で約${chars}字（${Math.max(1, Math.round(lines / 4))}段落くらい）`,
    '見出しの言葉を、本文の最初でそのままくり返さない',
    ...(hasDraft ? ['下の「今の下書き」がある場合は、その内容を生かして読みやすく整える'] : []),
    ...COMMON,
  ])}

【先生のメモ】（箇条書き）
${memoBlock(memo)}${hasDraft ? `

【今の下書き】
${draft.join('\n')}` : ''}`;
}

/**
 * AIから返ってきた文章を、学年だよりの段落の並びにする。
 * 前置き（「以下が文章です」など）、記号、Markdownの飾り、段落の頭の空白を取り除く。文の中身は変えない。
 */
export function cleanAiText(text, { title = '' } = {}) {
  let lines = String(text || '').replace(/\r/g, '').split('\n');
  lines = lines
    .filter((l) => !/^\s*```/.test(l))                       // コードの囲み
    .map((l) => l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*#+\s*/, '').replace(/^\s*[-*・]\s+/, ''))
    .map((l) => l.replace(/^[\s　]+/, '').replace(/[\s　]+$/, ''))
    .filter((l) => l !== '' && !/^[-=_*]{3,}$/.test(l));
  // 最初の行が前置き・最後の行があとがきなら取り除く
  if (lines.length > 1 && AI_PREFACE.test(lines[0])) lines.shift();
  // 見出しをくり返した1行目（「稲刈りしました」「【稲刈りしました】」など）
  const bare = (s) => s.replace(/[\s　「」『』【】《》〈〉]/g, '');
  if (title && lines.length > 1 && bare(lines[0]) === bare(title)) lines.shift();
  if (lines.length > 1 && isAiAfterword(lines[lines.length - 1])) lines.pop();
  return lines;
}

/** AIの返事の前置き（「以下が文章です」など）とあとがき（「修正のご希望があれば」など）の形 */
export const AI_PREFACE = /^(以下|はい|承知|かしこまり|もちろん|こちら|了解).{0,40}(です|ます|した|。|：|:)$/;
const AI_AFTER = /(修正|調整|変更|ご要望|お気軽|いかがでしょうか|必要があれば|ご希望).{0,40}$/;
export const isAiAfterword = (l) => AI_AFTER.test(l) && l.length < 80;

/** 子どもの名前らしい書き方（〇〇くん・〇〇さん）を、すべて探す */
export function findNames(text) {
  const out = [];
  const re = /([一-龥ぁ-んァ-ヶーA-Za-z]{1,6})(くん|君|さん|ちゃん)/g;
  for (const r of String(text || '').matchAll(re)) {
    if (/^(保護者の皆|皆|みな|地域の方|お客|業者|先生|校長|教頭|お母|お父|お兄|お姉|おじい|おばあ|方々)/.test(r[1])
      || /(の方|方|皆|みな|お客|お子|赤|お母|お父|お兄|お姉|おじい|おばあ|先生|業者|職員|店員|講師|たく|みな|ごちそう|おつかれ|お疲れ|おひな|お日|お月|お巡り|おまわり|お医者|屋)$/.test(r[1])) continue;
    if (!out.includes(r[0])) out.push(r[0]);
  }
  return out;
}
/** メモに子どもの名前らしい書き方（〇〇くん・〇〇さん）がないか（最初の1つ） */
export function looksLikeNames(text) { return findNames(text)[0] || null; }
