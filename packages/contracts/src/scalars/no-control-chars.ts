import { z } from 'zod';

// حروف التحكم (Cc = U+0000–U+001F و U+007F–U+009F) ممنوعة في كل الأسماء. النمط بينزل مع
// الـ OpenAPI، فبينكتب كبحث بسيط من غير anchor ولا lookahead: محرك RE2 (زي Go و Rust) مش
// بيعرف lookahead، والـ anchor لوحده مش كفاية لأن $ في Python و Java بيقبل السطر اللي قبل
// آخر سطر، فالبحث من غير anchor بيعمل نفس الحاجة في كل المحركات.
export const controlChar = new RegExp(`[\\x00-\\x1F\\x7F-\\x9F]`);

/**
 * بيمنع حروف التحكم من اسم، وبينشر المنع نفسه كـ not: { pattern } عشان العميل اللي مش
 * JavaScript يقدر يقرا القاعدة من غير property escape.
 *
 * @param schema مخطط الاسم اللي عايزين نحرّم منه حروف التحكم
 * @returns المخطط نفسه مع فحص حروف التحكم ومع المنع المنشور
 */
export function withoutControlChars<T extends z.ZodString>(schema: T) {
  return schema
    .refine((value) => !controlChar.test(value), {
      message: 'Control characters are not allowed',
    })
    .meta({ not: { pattern: controlChar.source } });
}
