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

// نطاقات تقنية: دومين مضمون بأي كتابة.
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
  'ca',
  'ch',
  'es',
  'se',
  'ar',
  'mx',
]);

// نطاقات كلمات: ممكن تيجي في نص عادي، والاستثناء الوحيد هو كتابة Capitalised بعد النقطة.
const WORD_TLDS = new Set([
  'me',
  'us',
  'it',
  'my',
  'co',
  'app',
  'shop',
  'store',
  'site',
  'link',
  'online',
  'info',
  'is',
  'in',
  'at',
  'to',
  'no',
  'so',
  'be',
  'do',
  'go',
  'am',
  'as',
  'id',
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
]);

// مسح خطّي للـ runs (حروف وأرقام ونقط)؛ مفيش quantifiers متداخلة.
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

// القاعدة: host بين @ أو / أو : = دومين، وIPv4 مع / أو : = دومين، وTLD معلوم بعد أول جزء = دومين.
// الاستثناء الوحيد: TLD كلمة (It, My, Me, Shop) مكتوب Capitalised بعد النقطة = نهاية جملة مش دومين.
// example.Shop يعدّي وده مقبول، لأن ADR-0011 بيعرض التعليق نص متهرب ومبيتحولش لدومين.
// ورفضه كان هيرفض جمل عادي زي Great service.It was perfect.
function containsBareDomain(value: string): boolean {
  for (const match of value.matchAll(RUN)) {
    const run = match[0];
    if (run === undefined) continue;
    const labels = run.split('.').filter((label) => label.length > 0);
    if (labels.length < 2) continue;
    const start = match.index ?? 0;
    const before = start > 0 ? value[start - 1] : undefined;
    const after = start + run.length < value.length ? value[start + run.length] : undefined;
    if (isIpv4Link(labels, after)) return true;
    if (!labels.some((label) => LETTER.test(label))) continue;
    if (before === '@' || before === '/' || after === '/' || after === ':') return true;
    if (hasListedTldAfterFirst(labels)) return true;
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
// السقف جوه الـ refinement فالمخطط المنشور كان string مفتوح؛ maxLength بيعدّ code points زي الفحص.
export const ratingComment = z
  .string()
  .superRefine((value, ctx) => {
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
  })
  .meta({
    maxLength: 1000,
    description:
      'No links, URLs, domains, markup or control characters; max 1000 chars (newline, tab, CR).',
  });
