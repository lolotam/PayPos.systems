import { z } from 'zod';

// ADR-0011 §4: التعليق من غير روابط ولا صور ولا مرفقات؛ العرض بيتهرب ودي طبقة تانية فوقه.
// الأنماط دي كلها خطّية (مفيش quantifier متداخل)، وأطول رجوع فيها محدود بسقف الـ 2000 وحدة اللي بيتفحص قبلها.
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

// نطاقات الـ TLD مقصودة: قاعدة عامة زي word.word كانت هترفض نص عادي زي e.g. أو نقطة ناقصة بعد الكلمة.
const BARE_DOMAIN_TLDS = new Set([
  'com',
  'net',
  'org',
  'info',
  'biz',
  'edu',
  'gov',
  'io',
  'co',
  'me',
  'app',
  'dev',
  'xyz',
  'online',
  'site',
  'shop',
  'store',
  'link',
  'ly',
  'gl',
  'tv',
  'cc',
  'ws',
  'us',
  'uk',
  'kw',
  'sa',
  'ae',
  'eg',
  'qa',
  'bh',
  'om',
  'travel',
  'news',
  'blog',
  'club',
  'live',
  'pro',
  'tech',
  'cloud',
  'website',
  'page',
  'top',
  'vip',
  'fun',
  'life',
  'world',
  'today',
  'email',
  'space',
  'agency',
  'digital',
  'media',
  'group',
  'team',
  'studio',
  'design',
  'ru',
  'de',
  'fr',
  'in',
  'pk',
  'jp',
  'cn',
  'tr',
  'ir',
  'iq',
  'jo',
  'lb',
  'ma',
  'dz',
  'tn',
  'sy',
  'ye',
  'sd',
  'ps',
]);

const TOKEN_SPLIT = /[^a-z0-9.-]+/i;
const LABEL = /^[a-z0-9-]+$/i;
const SENTENCE_BREAK = /^[A-Z][a-z]/;

// الدومين بيتفحص بتقسيم النص لأجزاء، مش بـ regexp مع quantifiers متداخلة، عشان مدخل زي a.a.a... ما يحرقش الحلقة.
function containsBareDomain(value: string): boolean {
  for (const token of value.split(TOKEN_SPLIT)) {
    if (!token.includes('.')) continue;
    const labels = token.split('.').filter((label) => label.length > 0);
    if (labels.length < 2) continue;
    if (!labels.every((label) => LABEL.test(label))) continue;
    const last = labels[labels.length - 1];
    if (last === undefined) continue;
    // حرف كبير وبعده حرف صغير بعد النقطة = نهاية جملة (Me, Us) مش دومين؛ المقايضة إن دومين صغيرة ناقصة فاصلة بترفض.
    if (SENTENCE_BREAK.test(last)) continue;
    if (BARE_DOMAIN_TLDS.has(last.toLowerCase())) return true;
  }
  return false;
}

// المسموح في التعليق: سطر جديد (10) ورجوع (13) وتاب (9)؛ وباقي control characters مرفوضة (NUL وDEL ونطاق C1).
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 10 || code === 13 || code === 9) continue;
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

function containsLinkOrMarkup(value: string): boolean {
  if (LINK_OR_MARKUP_PATTERNS.some((pattern) => pattern.test(value))) return true;
  return containsBareDomain(value);
}

// الفحوصات مرتبة وكل واحدة بتوقف عند أول فشل: مدخل ضخم مابيوصلش لفحص الـ regexes أصلاً.
export const ratingComment = z.string().superRefine((value, ctx) => {
  if (value.length > 2000) {
    ctx.addIssue({ code: 'custom', message: 'At most 1000 characters' });
    return;
  }
  if (Array.from(value).length > 1000) {
    ctx.addIssue({ code: 'custom', message: 'At most 1000 characters' });
    return;
  }
  if (hasControlCharacter(value)) {
    ctx.addIssue({ code: 'custom', message: 'Control characters are not allowed' });
    return;
  }
  if (containsLinkOrMarkup(value)) {
    ctx.addIssue({ code: 'custom', message: 'Links and markup are not allowed' });
  }
});
