import { alertRulesAr, alertRulesEn } from './alert-rules-catalog.js';
import { ar } from './ar.js';
import { commissionStatementAr, commissionStatementEn } from './commission-statement-catalog.js';
import { en } from './en.js';
import { nativeShellAr, nativeShellEn } from './native-shell-catalog.js';
import { sessionTipsAr, sessionTipsEn } from './session-tips-catalog.js';
import { serviceLineCancelAr, serviceLineCancelEn } from './service-line-cancel-catalog.js';
import { serviceLineEditAr, serviceLineEditEn } from './service-line-edit-catalog.js';
import {
  serviceLinePerformersAr,
  serviceLinePerformersEn,
} from './service-line-performers-catalog.js';
import { serviceSessionsAr, serviceSessionsEn } from './service-session-catalog.js';
import { staffAppColumnsAr, staffAppColumnsEn } from './staff-app-columns-catalog.js';
import { staffPushAr, staffPushEn } from './staff-push-catalog.js';

/** اللغتين اللي المنتج بيدعمهم — العربي الأساسي (CLAUDE.md §0). */
export type Locale = 'ar' | 'en';

/** شكل الكتالوج: نفس أقسام ومفاتيح en.ts، والقيم نصوص. */
export type Catalog = { readonly [S in keyof typeof en]: Record<keyof (typeof en)[S], string> };

type RegisteredCatalog = Catalog & {
  readonly alertRules: Record<keyof typeof alertRulesEn, string>;
  readonly commissionStatement: Record<keyof typeof commissionStatementEn, string>;
  readonly serviceSessions: Record<keyof typeof serviceSessionsEn, string>;
  readonly serviceLineEdit: Record<keyof typeof serviceLineEditEn, string>;
  readonly serviceLineCancel: Record<keyof typeof serviceLineCancelEn, string>;
  readonly serviceLinePerformers: Record<keyof typeof serviceLinePerformersEn, string>;
  readonly sessionTips: Record<keyof typeof sessionTipsEn, string>;
  readonly staffAppColumns: Record<keyof typeof staffAppColumnsEn, string>;
  readonly staffPush: Record<keyof typeof staffPushEn, string>;
  readonly nativeShell: Record<keyof typeof nativeShellEn, string>;
};

/** مفتاح رسالة: <القسم>.<الاسم>، زي errors.NOT_READY. */
export type MessageKey = {
  [S in keyof RegisteredCatalog]: `${S}.${keyof RegisteredCatalog[S] & string}`;
}[keyof RegisteredCatalog];

/** كود خطأ ليه رسالة في اللغتين — الـ API مبيرجعش كود مالوش رسالة. */
export type ErrorMessageCode = keyof typeof en.errors;

const CATALOGS: Record<Locale, RegisteredCatalog> = {
  ar: {
    ...ar,
    alertRules: alertRulesAr,
    commissionStatement: commissionStatementAr,
    serviceSessions: serviceSessionsAr,
    serviceLineEdit: serviceLineEditAr,
    serviceLineCancel: serviceLineCancelAr,
    serviceLinePerformers: serviceLinePerformersAr,
    sessionTips: sessionTipsAr,
    staffAppColumns: staffAppColumnsAr,
    staffPush: staffPushAr,
    nativeShell: nativeShellAr,
  },
  en: {
    ...en,
    alertRules: alertRulesEn,
    commissionStatement: commissionStatementEn,
    serviceSessions: serviceSessionsEn,
    serviceLineEdit: serviceLineEditEn,
    serviceLineCancel: serviceLineCancelEn,
    serviceLinePerformers: serviceLinePerformersEn,
    sessionTips: sessionTipsEn,
    staffAppColumns: staffAppColumnsEn,
    staffPush: staffPushEn,
    nativeShell: nativeShellEn,
  },
};

/**
 * بيجيب رسالة بلغة معينة من الكتالوج — مفيش نص عربي أو إنجليزي للمستخدم خارج packages/i18n (CLAUDE.md §7).
 *
 * @param locale ar أو en
 * @param key    المفتاح، زي errors.NOT_READY
 * @returns الرسالة
 */
export function t(locale: Locale, key: MessageKey): string {
  const [section, name] = key.split('.') as [keyof RegisteredCatalog, string];
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
