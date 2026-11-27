/** ألوان هوية PosPay: خلفية فاتحة، بطاقة بيضاء، نص حبر، وزر برتقالي. */
const PALETTE = {
  background: '#F7F1E8',
  card: '#FFFFFF',
  ink: '#0D1522',
  accent: '#FF6421',
  muted: '#5A6675',
  divider: '#E7DED2',
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, Arial, sans-serif";

/** سطر التذييل بال لغتين: البريد يقرأ بلغته، وسطر التذييل يبقى مفهومًا في الحالتين. */
const FOOTER = {
  ar: 'رسالة تلقائية من PosPay — بوس باي.',
  en: 'This is an automated message from PosPay.',
} as const;

/** أصول الهوية في البريد: نفس ملف العلامة اللي بتعرضه الواجهة، من نفس الأصل الآمن. */
const LOGO_PATH = '/brand/logo-mark-simple-tile.png';

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/** مدخلات التخطيط الموحّد لكل بريد من PosPay. */
export interface EmailLayoutInput {
  /** لغة الرسالة: العربية RTL والإنجليزية LTR. */
  readonly locale: 'ar' | 'en';
  /** أصل لوحة الإدارة الآمن، ومصدر صورة الهوية في البريد. */
  readonly adminOrigin: string;
  /** عنوان البريد. */
  readonly title: string;
  /** جسم البريد بصيغة HTML، يُركّبه القالب. */
  readonly bodyHtml: string;
  /** نفس الجسم بصيغة نصية، لنسخة البريد النصية. */
  readonly bodyText: string;
  /** زر الإجراء الاختياري: نص الزر ورابطه. */
  readonly action?: { readonly label: string; readonly url: string };
  /** ملاحظة اختيارية فوق تذييل البريد. */
  readonly footerNote?: string;
}

/** ناتج التخطيط: نسخة HTML ونسخة نصية بنفس المحتوى. */
export interface EmailLayout {
  readonly html: string;
  readonly text: string;
}

/** خطأ تخطيط البريد: أصل اللوحة غير آمن، فالبريد ما ينتجش أصلاً. */
export class EmailLayoutError extends Error {
  constructor() {
    super('EMAIL_LAYOUT_ORIGIN_INVALID');
  }
}

/**
 * يهرّب النص اللي بيتحط جوه HTML، عشان عنوان أو زر ما يبقاش markup.
 *
 * @param value النص الخام
 * @returns النص بعد استبدال الرموز الخاصة
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES.get(character) ?? character);
}

/**
 * يفحص أصل اللوحة ويفضّله من غير slash لآخر، عشان رابط الهوية ما يتكررش فيه slash.
 *
 * @param adminOrigin الأصل كما جاء
 * @returns الأصل الآمن من غير slash لآخر
 */
function normalizeAdminOrigin(adminOrigin: string): string {
  let url: URL;
  try {
    url = new URL(adminOrigin);
  } catch {
    throw new EmailLayoutError();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname === '' ||
    url.username !== '' ||
    url.password !== ''
  )
    throw new EmailLayoutError();
  if (url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/'))
    throw new EmailLayoutError();
  return url.origin;
}

function normalizeActionUrl(actionUrl: string, allowedOrigin: string): string {
  let url: URL;
  try {
    url = new URL(actionUrl);
  } catch {
    throw new EmailLayoutError();
  }
  if (url.username !== '' || url.password !== '' || url.origin !== allowedOrigin) {
    throw new EmailLayoutError();
  }
  return url.toString();
}

/**
 * يبني صف جدول واحد؛ البريد كله جداول عشان يبقى responsive من غير CSS خارجي.
 *
 * @param content محتوى الخلية
 * @param style ستايل الخلية
 * @returns صف HTML جاهز
 */
function row(content: string, style: string): string {
  return `<tr><td style="${style}">${content}</td></tr>`;
}

/**
 * يبني رأس التخطيط: صورة الهوية فوق العنوان.
 *
 * @param origin أصل اللوحة الآمن
 * @returns صف HTML لرأس البطاقة
 */
function headerRow(origin: string): string {
  const logo = `<img src="${origin}${LOGO_PATH}" alt="PosPay" width="48" height="48" style="display:block;width:48px;height:48px;border:0;border-radius:10px;" />`;
  return row(logo, 'padding:24px 24px 0 24px;');
}

/**
 * يبني صف زر الإجراء، أو سطر فاضي لما مفيش زر.
 *
 * @param action الزر الاختياري
 * @returns صف HTML لزر الإجراء
 */
function actionRow(action: EmailLayoutInput['action']): string {
  if (action === undefined) return '';
  const style = `display:inline-block;background-color:${PALETTE.accent};color:${PALETTE.card};font-family:${FONT};font-size:15px;font-weight:600;line-height:1;text-decoration:none;padding:14px 24px;border-radius:10px;`;
  const link = `<a href="${escapeHtml(action.url)}" style="${style}">${escapeHtml(action.label)}</a>`;
  return row(link, 'padding:20px 24px 0 24px;');
}

/**
 * يبني تذييل البريد: فاصل ثم سطرين بلغتين ثم الملاحظة الاختيارية.
 *
 * @param input مدخلات التخطيط
 * @returns صفوف HTML للتذييل
 */
function footerRows(input: EmailLayoutInput): string {
  const divider = row(
    `<div style="border-top:1px solid ${PALETTE.divider};font-size:0;line-height:0;">&nbsp;</div>`,
    'padding:24px 24px 0 24px;',
  );
  const note =
    input.footerNote === undefined
      ? ''
      : `<p style="margin:8px 0 0 0;">${escapeHtml(input.footerNote)}</p>`;
  const lines = `<p style="margin:0;">${escapeHtml(FOOTER.ar)}</p><p style="margin:0;">${escapeHtml(FOOTER.en)}</p>${note}`;
  const style = `padding:16px 24px 24px 24px;font-family:${FONT};font-size:12px;line-height:1.6;color:${PALETTE.muted};`;
  return `${divider}${row(lines, style)}`;
}

/**
 * يبني نسخة HTML: جدول متجاوب بستايل inline بس، من غير أي ملف خارجي.
 *
 * @param input مدخلات التخطيط
 * @param origin أصل اللوحة الآمن
 * @returns البريد بصيغة HTML
 */
function renderHtml(input: EmailLayoutInput, origin: string): string {
  const direction = input.locale === 'ar' ? 'rtl' : 'ltr';
  const titleStyle = `padding:20px 24px 0 24px;font-family:${FONT};font-size:20px;font-weight:700;line-height:1.4;color:${PALETTE.ink};`;
  const bodyStyle = `padding:12px 24px 0 24px;font-family:${FONT};font-size:15px;line-height:1.6;color:${PALETTE.ink};`;
  return `<!doctype html>
<html lang="${input.locale}" dir="${direction}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PALETTE.background};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.background};border-collapse:collapse;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:${PALETTE.card};border-radius:16px;border-collapse:collapse;">
          ${headerRow(origin)}
          ${row(escapeHtml(input.title), titleStyle)}
          ${row(input.bodyHtml, bodyStyle)}
          ${actionRow(input.action)}
          ${footerRows(input)}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * يبني نسخة النصية: نفس العنوان والجسم والزر والتذييل، من غير markup.
 *
 * @param input مدخلات التخطيط
 * @returns البريد بصيغة نصية
 */
function renderText(input: EmailLayoutInput): string {
  const blocks: string[] = [input.title, input.bodyText];
  if (input.action !== undefined) blocks.push(`${input.action.label}\n${input.action.url}`);
  blocks.push(`${FOOTER.ar}\n${FOOTER.en}`);
  if (input.footerNote !== undefined) blocks.push(input.footerNote);
  return blocks.join('\n\n');
}

/**
 * يبني البريد الموحّد: نسخة HTML ونسخة نصية بنفس المحتوى.
 * كل قالب بريد في الحزمة بيمر من هنا، عشان كل رسالة تأخذ نفس الشكل ونفس الهوية.
 *
 * @param input مدخلات التخطيط
 * @returns البريد بصيغتيه
 */
export function renderEmailLayout(input: EmailLayoutInput): EmailLayout {
  const origin = normalizeAdminOrigin(input.adminOrigin);
  const action =
    input.action === undefined
      ? undefined
      : { label: input.action.label, url: normalizeActionUrl(input.action.url, origin) };
  const safeInput: EmailLayoutInput = action === undefined ? input : { ...input, action };
  return { html: renderHtml(safeInput, origin), text: renderText(safeInput) };
}
