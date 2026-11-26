import { myLeaveAr, myLeaveEn } from './my-leave-catalog.js';
import { myWorkAr, myWorkEn } from './my-work-catalog.js';
import { myAttendanceAr, myAttendanceEn } from './my-attendance-catalog.js';
import { leaveHistoryAr, leaveHistoryEn } from './leave-history-catalog.js';
import { alertRulesAr, alertRulesEn } from './alert-rules-catalog.js';
import { adminNavAr, adminNavEn, schedulesAr, schedulesEn } from './admin-nav-catalog.js';
import { adminNavPagesAr } from './admin-nav-pages-ar.js';
import { adminNavPagesEn } from './admin-nav-pages-en.js';
import { ar } from './ar.js';
import {
  commissionPlanBuilderAr,
  commissionPlanBuilderEn,
} from './commission-plan-builder-catalog.js';
import { commissionOverridesAr, commissionOverridesEn } from './commission-override-catalog.js';
import { commissionStatementAr, commissionStatementEn } from './commission-statement-catalog.js';
import {
  commissionStatementScreenAr,
  commissionStatementScreenEn,
} from './commission-statement-screen-catalog.js';
import { en } from './en.js';
import { nativeShellAr, nativeShellEn } from './native-shell-catalog.js';
import { packageImportAr, packageImportEn } from './package-import-catalog.js';
import { packageSaleAr, packageSaleEn } from './package-sale-catalog.js';
import { customerPackagesAr, customerPackagesEn } from './customer-packages-catalog.js';
import { branchHoursAr, branchHoursEn } from './branch-hours-catalog.js';
import { importedRefundsAr, importedRefundsEn } from './imported-refunds-catalog.js';
import { ratingRequestAr, ratingRequestEn } from './rating-catalog.js';
import { ratingsAr, ratingsEn } from './ratings-catalog.js';
import { publicRatingAr, publicRatingEn } from './public-rating-catalog.js';
import { sessionTipsAr, sessionTipsEn } from './session-tips-catalog.js';
import { serviceLineCancelAr, serviceLineCancelEn } from './service-line-cancel-catalog.js';
import { serviceLineEditAr, serviceLineEditEn } from './service-line-edit-catalog.js';
import {
  serviceLinePerformersAr,
  serviceLinePerformersEn,
} from './service-line-performers-catalog.js';
import { serviceSessionsAr, serviceSessionsEn } from './service-session-catalog.js';
import { discountApprovalAr, discountApprovalEn } from './discount-approval-catalog.js';
import {
  deviceDiscountApprovalAr,
  deviceDiscountApprovalEn,
} from './device-discount-approval-catalog.js';
import { staffAppColumnsAr, staffAppColumnsEn } from './staff-app-columns-catalog.js';
import { staffPushAr, staffPushEn } from './staff-push-catalog.js';

/** اللغتين اللي المنتج بيدعمهم — العربي الأساسي (CLAUDE.md §0). */
export type Locale = 'ar' | 'en';

/** شكل الكتالوج: نفس أقسام ومفاتيح en.ts، والقيم نصوص. */
export type Catalog = { readonly [S in keyof typeof en]: Record<keyof (typeof en)[S], string> };

type RegisteredCatalog = Catalog & {
  readonly myLeave: Record<keyof typeof myLeaveEn, string>;
  readonly myWork: Record<keyof typeof myWorkEn, string>;
  readonly myAttendance: Record<keyof typeof myAttendanceEn, string>;
  readonly leaveHistory: Record<keyof typeof leaveHistoryEn, string>;
  readonly publicRating: Record<keyof typeof publicRatingEn, string>;
  readonly alertRules: Record<keyof typeof alertRulesEn, string>;
  readonly commissionPlanBuilder: Record<keyof typeof commissionPlanBuilderEn, string>;
  readonly commissionOverrides: Record<keyof typeof commissionOverridesEn, string>;
  readonly commissionStatement: Record<keyof typeof commissionStatementEn, string>;
  readonly commissionStatementScreen: Record<keyof typeof commissionStatementScreenEn, string>;
  readonly serviceSessions: Record<keyof typeof serviceSessionsEn, string>;
  readonly discountApproval: Record<keyof typeof discountApprovalEn, string>;
  readonly deviceDiscountApproval: Record<keyof typeof deviceDiscountApprovalEn, string>;
  readonly serviceLineEdit: Record<keyof typeof serviceLineEditEn, string>;
  readonly serviceLineCancel: Record<keyof typeof serviceLineCancelEn, string>;
  readonly serviceLinePerformers: Record<keyof typeof serviceLinePerformersEn, string>;
  readonly sessionTips: Record<keyof typeof sessionTipsEn, string>;
  readonly staffAppColumns: Record<keyof typeof staffAppColumnsEn, string>;
  readonly staffPush: Record<keyof typeof staffPushEn, string>;
  readonly nativeShell: Record<keyof typeof nativeShellEn, string>;
  readonly packageSale: Record<keyof typeof packageSaleEn, string>;
  readonly packageImport: Record<keyof typeof packageImportEn, string>;
  readonly ratingRequest: Record<keyof typeof ratingRequestEn, string>;
  readonly ratings: Record<keyof typeof ratingsEn, string>;
  readonly customerPackages: Record<keyof typeof customerPackagesEn, string>;
  readonly importedRefunds: Record<keyof typeof importedRefundsEn, string>;
  readonly branchHours: Record<keyof typeof branchHoursEn, string>;
  readonly schedules: Record<keyof typeof schedulesEn, string>;
  readonly adminNav: Record<keyof typeof adminNavEn, string>;
  readonly adminNavPages: Record<keyof typeof adminNavPagesEn, string>;
};

/** مفتاح رسالة: <القسم>.<الاسم>، زي errors.NOT_READY. */
export type MessageKey = {
  [S in keyof RegisteredCatalog]: `${S}.${keyof RegisteredCatalog[S] & string}`;
}[keyof RegisteredCatalog];

/** كود خطأ ليه رسالة في اللغتين — الـ API مبيرجعش كود مالوش رسالة. */
export type ErrorMessageCode = keyof typeof en.errors;

const CATALOGS: Record<Locale, RegisteredCatalog> = {
  ar: {
    myLeave: myLeaveAr,
    myWork: myWorkAr,
    myAttendance: myAttendanceAr,
    leaveHistory: leaveHistoryAr,
    publicRating: publicRatingAr,
    ...ar,
    alertRules: alertRulesAr,
    commissionPlanBuilder: commissionPlanBuilderAr,
    commissionOverrides: commissionOverridesAr,
    commissionStatement: commissionStatementAr,
    commissionStatementScreen: commissionStatementScreenAr,
    serviceSessions: serviceSessionsAr,
    discountApproval: discountApprovalAr,
    deviceDiscountApproval: deviceDiscountApprovalAr,
    serviceLineEdit: serviceLineEditAr,
    serviceLineCancel: serviceLineCancelAr,
    serviceLinePerformers: serviceLinePerformersAr,
    sessionTips: sessionTipsAr,
    staffAppColumns: staffAppColumnsAr,
    staffPush: staffPushAr,
    nativeShell: nativeShellAr,
    packageSale: packageSaleAr,
    packageImport: packageImportAr,
    ratingRequest: ratingRequestAr,
    ratings: ratingsAr,
    customerPackages: customerPackagesAr,
    importedRefunds: importedRefundsAr,
    branchHours: branchHoursAr,
    schedules: schedulesAr,
    adminNav: adminNavAr,
    adminNavPages: adminNavPagesAr,
  },
  en: {
    myLeave: myLeaveEn,
    myWork: myWorkEn,
    myAttendance: myAttendanceEn,
    leaveHistory: leaveHistoryEn,
    publicRating: publicRatingEn,
    ...en,
    alertRules: alertRulesEn,
    commissionPlanBuilder: commissionPlanBuilderEn,
    commissionOverrides: commissionOverridesEn,
    commissionStatement: commissionStatementEn,
    commissionStatementScreen: commissionStatementScreenEn,
    serviceSessions: serviceSessionsEn,
    discountApproval: discountApprovalEn,
    deviceDiscountApproval: deviceDiscountApprovalEn,
    serviceLineEdit: serviceLineEditEn,
    serviceLineCancel: serviceLineCancelEn,
    serviceLinePerformers: serviceLinePerformersEn,
    sessionTips: sessionTipsEn,
    staffAppColumns: staffAppColumnsEn,
    staffPush: staffPushEn,
    nativeShell: nativeShellEn,
    packageSale: packageSaleEn,
    packageImport: packageImportEn,
    ratingRequest: ratingRequestEn,
    ratings: ratingsEn,
    customerPackages: customerPackagesEn,
    importedRefunds: importedRefundsEn,
    branchHours: branchHoursEn,
    schedules: schedulesEn,
    adminNav: adminNavEn,
    adminNavPages: adminNavPagesEn,
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
