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

// نطاقات تقنية: أي كتابة بتعدّي كدومين.
const TECHNICAL_TLDS = new Set([
  'com',
  'net',
  'org',
  'biz',
  'edu',
  'gov',
  'io',
  'dev',
  'xyz',
  'ly',
  'gl',
  'tv',
  'cc',
  'ws',
  'uk',
  'kw',
  'sa',
  'ae',
  'eg',
  'qa',
  'bh',
  'om',
  'ru',
  'de',
  'fr',
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
  'au',
  'za',
  'br',
  'nz',
  'my',
  'ca',
  'ch',
  'es',
  'it',
  'nl',
  'se',
  'sg',
  'hk',
  'id',
  'ng',
  'ke',
  'ar',
  'mx',
]);

// نطاقات كلمات: ممكن تيجي في نص عادي، فبترفضها بس لو صغيرة أو مش Capitalised.
const WORD_TLDS = new Set([
  'me',
  'us',
  'co',
  'app',
  'shop',
  'store',
  'site',
  'link',
  'online',
  'info',
  'in',
  'top',
  'live',
  'life',
  'world',
  'today',
  'news',
  'blog',
  'club',
  'page',
  'space',
  'team',
  'group',
  'media',
  'design',
  'studio',
  'digital',
  'agency',
  'email',
  'tech',
  'cloud',
  'travel',
  'fun',
  'pro',
  'vip',
  'website',
]);

const TOKEN_SPLIT = /[^a-z0-9.]+/i;
const LABEL = /^[a-z0-9]+$/i;
const CAPITALISED = /^[A-Z][a-z]+$/;

// الدومين بيتفحص بتقسيم النص لأجزاء، مش بـ regexp مع quantifiers متداخلة، عشان مدخل زي a.a.a... ما يحرقش الحلقة.
// نطاقات الـ TLD التقنية دومين بأي كتابة، ونطاقات الكلمات دومين إلا لو مكتوبة Capitalised بعد النقطة.
// المقايضة إن Example.Me يعدّي، وكل دومين صغير ناقصة فاصلة بيرفض.
function containsBareDomain(value: string): boolean {
  for (const token of value.split(TOKEN_SPLIT)) {
    if (!token.includes('.')) continue;
    const labels = token.split('.').filter((label) => label.length > 0);
    if (labels.length < 2) continue;
    if (!labels.every((label) => LABEL.test(label))) continue;
    for (const label of labels.slice(1)) {
      const lower = label.toLowerCase();
      if (TECHNICAL_TLDS.has(lower)) return true;
      if (WORD_TLDS.has(lower) && !CAPITALISED.test(label)) return true;
    }
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
