import type { Type } from '@nestjs/common';
import {
  createAuth,
  type AuthService,
  type StaffOtpApi,
  type StaffPinResetApi,
} from '@pospay/auth';
import type { Database, IdGenerator, TenantWrappers } from '@pospay/db';
import { phoneLockKey } from '@pospay/notifications';
import { createLogger, type DestinationStream, type Logger } from '@pospay/observability';

import { createPersonalEligibility } from '../src/modules/staff/index.ts';
import type { FilesRuntime } from '../src/modules/files/index.ts';
import { API_LOG_EVENTS } from '../src/shared/log-events.ts';
import type { ServiceFactory } from './service-factory.ts';

export const HARNESS_BASE = 'http://api.test';
export const HARNESS_ORIGIN = 'http://admin.test';

/**
 * @param options where the API's log lines go (default: nowhere)
 * @param options.logs a destination stream for the API's logger
 * @returns a started API, its database, and helpers that go through the real HTTP paths
 */
export interface HarnessOptions {
  files?: FilesRuntime;
  logs?: DestinationStream;
  staffOrigin?: string;
  staffNativeOrigins?: readonly string[];
  clock?: { now(): Date };
  ordersClock?: { now(): Date };
  /** ساعة موديول العملاء — قرار رفض التقييم بيقاس بيها. */
  customersClock?: { now(): Date };
  /** أقصى عمر لمعاملة رفض التقييم. */
  customersTransactionTimeoutMs?: number;
  /** هل قدرة روابط التقييم متاحة؟ false بتجيب NOT_READY قبل أي حدّ. */
  ratingLinksAvailable?: boolean;
  /** الـ proxies الموثوقين؛ من غيرهم كل الزوار بيشاركوا عنوان الـ proxy. */
  trustedProxy?: readonly string[];
  /** من غير Redis مفيش حدّ على المسارات العامة، فبترد NOT_READY. */
  omitRedis?: boolean;
  /** بوابة دخول الموظفات (FR-F1-9): المسارات ترد NOT_READY ما دامت مطفأة. */
  staffAccessRoutes?: boolean;
  /** الأصول المسموحة بـ CORS؛ بدونها لا يُسمح لأي أصل. */
  corsOrigins?: readonly string[];
  commissionsClock?: { now(): Date };
  /** يلفّ غلاف قاعدة التطبيق، عشان اختبار يسجّل اتصالات معاملات الطلبات الحقيقية. */
  wrapDatabase?: (database: TenantWrappers) => TenantWrappers;
  staffOtpFactory?: ServiceFactory<StaffOtpApi>;
  /** استعادة الموظفة رقمها السري (spec 079 PR-c1): الاختبار بيبني الخدمة ويقفلها بنفسه. */
  staffPinResetFactory?: ServiceFactory<StaffPinResetApi>;
  /** كاونترات اختبار بتركب جنب الكاونترات الحقيقية، عشان مسار محمي يتجرب. */
  controllers?: readonly Type<unknown>[];
  /** مصدر الجلسة الشخصية؛ من غيره المسار الشخصي مرفوض زي أي طلب بلا جلسة. */
  personalOrigin?: string;
  /** بادئة اسم cookies الجلسة — للاختبار اللي بي证明了 إن cookie بيئة تانية ما بتتقراش. */
  cookiePrefix?: string;
  /** مفتاح ختم إيميلات الترحيب — من غيره مفيش بريد ترحيب ولا بريد دعوة. */
  onboardingEmailKey?: string;
}

export function optionalWiring(options: HarnessOptions) {
  return {
    ...(options.ordersClock === undefined ? {} : { ordersClock: options.ordersClock }),
    ...(options.customersClock === undefined ? {} : { customersClock: options.customersClock }),
    ...(options.customersTransactionTimeoutMs === undefined
      ? {}
      : { customersTransactionTimeoutMs: options.customersTransactionTimeoutMs }),
    ...(options.ratingLinksAvailable === undefined
      ? {}
      : { ratingLinksAvailable: options.ratingLinksAvailable }),
    ...(options.trustedProxy === undefined ? {} : { trustedProxy: options.trustedProxy }),
    ...(options.commissionsClock === undefined
      ? {}
      : { commissionsClock: options.commissionsClock }),
    ...(options.files === undefined ? {} : { files: options.files }),
    // أصل اللوحة اللي رابط الدعوة بيتبنى عليه وساعتها؛ بوابة المسارات بتتفتح من الاختبارات اللي محتاجاها بس.
    memberInvitations: {
      adminOrigin: HARNESS_ORIGIN,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    },
    ...(options.staffAccessRoutes === true ? { staffAccessRoutes: true } : {}),
    ...(options.onboardingEmailKey === undefined
      ? {}
      : { onboardingEmailKey: options.onboardingEmailKey }),
  };
}

export function staffWiring(
  options: HarnessOptions,
  api: StaffOtpApi | undefined,
  auth: AuthService,
) {
  // بوابة دخول الموظفات: الاختبارات التي تحتاج المسارات تشغّلها صراحةً (FR-F1-9).
  const gate = options.staffAccessRoutes === true ? { staffAccessRoutes: true } : {};
  const origins =
    options.staffOrigin === undefined
      ? {}
      : {
          staff: {
            api: api ?? null,
            sessions: auth.staff ?? null,
            origin: options.staffOrigin,
            nativeOrigins: options.staffNativeOrigins ?? [],
          },
        };
  // ساعة اختبار الموظفات: نفس ساعة الاختبار، عشان مدّة الرقم المؤقت ومدّة دليل التغيير يتقاسوا بيها.
  return { staffPinClock: options.clock, ...gate, ...origins };
}

// الجلسة الشخصية لها مصدر وجلسة وأهلية؛ من غير ما تتركب المسار الشخصي مرفوض.
export function personalWiring(options: HarnessOptions, auth: AuthService, database: Database) {
  return options.personalOrigin === undefined
    ? {}
    : {
        personal: {
          origin: options.personalOrigin,
          sessions: auth.personal ?? null,
          eligibility: createPersonalEligibility(database),
          otp: null,
        },
      };
}

export function harnessLogger(options: HarnessOptions): Logger {
  return options.logs === undefined
    ? createLogger('silent')
    : createLogger('info', { destination: options.logs, events: API_LOG_EVENTS });
}

export function harnessAuth(
  authUrl: string,
  ids: IdGenerator,
  options: HarnessOptions,
): Promise<AuthService> {
  return createAuth({
    staffPhoneLockKey: phoneLockKey,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    databaseUrl: authUrl,
    secret: 'test-secret-that-is-long-enough-for-hmac',
    baseURL: HARNESS_BASE,
    trustedOrigins: [
      HARNESS_ORIGIN,
      ...(options.staffOrigin === undefined ? [] : [options.staffOrigin]),
    ],
    ids,
    secureCookies: false,
    ...(options.cookiePrefix === undefined ? {} : { cookiePrefix: options.cookiePrefix }),
    onLog: () => undefined,
  });
}
