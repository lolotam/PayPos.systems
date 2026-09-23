import { ar } from './ar.js';
import { en } from './en.js';

/** اللغتين اللي المنتج بيدعمهم — العربي الأساسي (CLAUDE.md §0). */
export type Locale = 'ar' | 'en';

/** شكل الكتالوج: نفس أقسام ومفاتيح en.ts، والقيم نصوص. */
export type Catalog = { readonly [S in keyof typeof en]: Record<keyof (typeof en)[S], string> };

/** مفتاح رسالة: <القسم>.<الاسم>، زي errors.NOT_READY. */
export type MessageKey = {
  [S in keyof typeof en]: `${S}.${keyof (typeof en)[S] & string}`;
}[keyof typeof en];

/** كود خطأ ليه رسالة في اللغتين — الـ API مبيرجعش كود مالوش رسالة. */
export type ErrorMessageCode = keyof typeof en.errors;

const CATALOGS: Record<Locale, Catalog> = { ar, en };

/**
 * بيجيب رسالة بلغة معينة من الكتالوج — مفيش نص عربي أو إنجليزي للمستخدم خارج packages/i18n (CLAUDE.md §7).
 *
 * @param locale ar أو en
 * @param key    المفتاح، زي errors.NOT_READY
 * @returns الرسالة
 */
export function t(locale: Locale, key: MessageKey): string {
  const [section, name] = key.split('.') as [keyof Catalog, string];
  return (CATALOGS[locale][section] as Record<string, string>)[name] ?? key;
}

/**
 * رسالة الخطأ في اللغتين مع بعض، زي ما الـ error envelope بيحتاجها (CLAUDE.md §6).
 *
 * @param code كود الخطأ
 * @returns message_ar و message_en
 */
export function errorMessages(code: ErrorMessageCode): { message_ar: string; message_en: string } {
  return { message_ar: ar.errors[code], message_en: en.errors[code] };
}
