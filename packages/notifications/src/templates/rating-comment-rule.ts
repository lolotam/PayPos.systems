// نسخة مطابقة لقاعدة ratingComment في packages/contracts/src/customers/rating-comment.ts، لأن الحزمة دي
// ما بتعتمدش على contracts ولا zod. أي تغيير هناك يتعمل هنا في نفس الـ PR؛ اختبار التطابق في الـ worker
// (low-rating-template-parity.spec.ts) بيفشل لو النسختين اختلفوا على نفس العينة.
const LINK_OR_MARKUP_PATTERNS = [
  /https?:\/\//i,
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /\b(?:mailto|tel|sms|data|javascript|vbscript|callto|whatsapp|skype|geo|magnet|blob):[^\s]/i,
  /(?:^|\s)\/\/[a-z0-9]/i,
  /(?:^|[^a-z0-9])www\./i,
  /<\/?[a-z][a-z0-9-]*[\s/>]/i,
  /!\[/,
  /\]\(/,
];
const TECHNICAL_TLDS = new Set(
  (
    'com net org biz edu gov io dev xyz ly gl tv cc ws uk kw sa ae eg qa bh om ru de fr pk jp cn tr ir ' +
    'iq jo lb ma dz tn sy ye sd ps au za br nz ca ch es se ar mx'
  ).split(' '),
);
const WORD_TLDS = new Set(
  (
    'me us it my co app shop store site link online info is in at to no so be do go am as id travel news ' +
    'blog club live pro tech cloud website page top vip fun life world today email space agency digital ' +
    'media group team studio design'
  ).split(' '),
);
const RUN = /[a-z0-9.]+/gi;
const LETTER = /[a-z]/i;
const DIGITS = /^[0-9]+$/;
const SENTENCE_BREAK = /^[A-Z][a-z]+$/;

function isIpv4Link(labels: string[], after: string | undefined): boolean {
  if (labels.length !== 4) return false;
  if (!labels.every((label) => DIGITS.test(label))) return false;
  if (!labels.every((label) => Number(label) <= 255)) return false;
  return after === '/' || after === ':';
}

function hasListedTldAfterFirst(labels: string[]): boolean {
  for (let index = 1; index < labels.length; index += 1) {
    const label = labels[index];
    if (label === undefined) continue;
    const lower = label.toLowerCase();
    if (TECHNICAL_TLDS.has(lower)) return true;
    if (!WORD_TLDS.has(lower)) continue;
    if (labels.length === 2 && SENTENCE_BREAK.test(label)) continue;
    return true;
  }
  return false;
}

function containsBareDomain(value: string): boolean {
  for (const match of value.matchAll(RUN)) {
    const run = match[0];
    const labels = run.split('.').filter((label) => label.length > 0);
    if (labels.length < 2) continue;
    const start = match.index;
    const before = start > 0 ? value[start - 1] : undefined;
    const after = start + run.length < value.length ? value[start + run.length] : undefined;
    if (isIpv4Link(labels, after)) return true;
    if (!labels.some((label) => LETTER.test(label))) continue;
    if (before === '@' || before === '/' || after === '/' || after === ':') return true;
    if (hasListedTldAfterFirst(labels)) return true;
  }
  return false;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 10 || code === 13 || code === 9) continue;
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

/**
 * بيقرر هل تعليق العميل مسموح يتخزن في الجرس: نفس قاعدة ratingComment بالظبط.
 * أقصى 1000 code point، ومن غير روابط ولا markup ولا control characters غير LF وCR والتاب.
 *
 * @param value القيمة كما وصلت في تفاصيل الجرس
 * @returns true لو القيمة نص يقبله ratingComment
 */
export function ratingCommentAllowed(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2000) return false;
  if (Array.from(value).length > 1000 || hasControlCharacter(value)) return false;
  if (LINK_OR_MARKUP_PATTERNS.some((pattern) => pattern.test(value))) return false;
  return !containsBareDomain(value);
}
