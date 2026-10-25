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

// نطاقات الـ TLD كلها (تقنية وكلمات عادية) في set واحد.
const TLDS = new Set([
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

// تقسيم خطّي: مفيش quantifiers متداخلة، عشان مدخل زي a.a.a... ما يحرقش الحلقة.
const TOKEN_SPLIT = /[^a-z0-9.@/:]+/i;
const LABEL = /^[a-z0-9]+$/i;
const LETTER = /[a-z]/i;
const SENTENCE_BREAK = /^[A-Z][a-z]+$/;

// القاعدة: توكين بنقطة دومين لو فيه @ أو /، أو 3 أجزاء (ماعدا الاختصارات)، أو جزئين والتاني TLD ومش Capitalised.
// Capitalised بعد النقطة = نهاية جملة (It, My, Me, Shop)، فـ example.Shop وexample.Com يعدّوا وده مقبول.
// ADR-0011 بيعرض التعليق نص متهرب ومبيتحولش لدومين؛ ورفض كل TLD Capitalised هيرفض جمل عادي.
// زي Great service.It was perfect اللي مفيش فيها مسافة بعد النقطة.
function containsBareDomain(value: string): boolean {
  for (const token of value.split(TOKEN_SPLIT)) {
    if (!token.includes('.')) continue;
    const hasAt = token.includes('@');
    const hasSlash = token.includes('/');
    let core = hasAt ? token.slice(token.lastIndexOf('@') + 1) : token;
    if (core.includes('/')) core = core.slice(0, core.indexOf('/'));
    const labels = core.split('.').filter((label) => label.length > 0);
    if (labels.length < 2) continue;
    if (!labels.every((label) => LABEL.test(label))) continue;
    if (!labels.some((label) => LETTER.test(label))) continue;
    if (hasAt || hasSlash) return true;
    if (labels.length >= 3 && !labels.every((label) => label.length === 1)) return true;
    if (labels.length === 2) {
      const last = labels[1];
      if (last === undefined) continue;
      if (TLDS.has(last.toLowerCase()) && !SENTENCE_BREAK.test(last)) return true;
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
