import type { Type } from '@nestjs/common';
import type {
  AuthService,
  PasswordResetOtpApi,
  StaffOtpApi,
  StaffPinResetApi,
  StaffSessions,
} from '@pospay/auth';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { PushApiConfiguration } from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';
import type { FilesRuntime } from './modules/files/index.ts';
import type { ResendIntake, WhatsappIntake } from './modules/notifications/index.ts';
import type { PersonalAuthentication } from './shared/personal-authentication.ts';
import type { Clock } from './shared/ports/clock.port.ts';
import type { ReadinessCheck } from './shared/readiness.ts';

export interface AppDependencies {
  readonly ordersClock?: { now(): Date };
  /** ساعة موديول العملاء — قرار رفض التقييم بيقاس بيها، عشان الاختبار يثبّت الوقت. */
  readonly customersClock?: { now(): Date };
  /** أقصى عمر لمعاملة رفض التقييم؛ القفل ما يعلّقش الطلب على زائر. */
  readonly customersTransactionTimeoutMs?: number;
  /**
   * هل قدرة روابط التقييم العامة متاحة؟ false من غير proxy موثوق — المسارات العامة بترد NOT_READY
   * قبل أي حدّ أو قاعدة بيانات (ADR-0011 §4).
   */
  readonly ratingLinksAvailable?: boolean;
  readonly commissionsClock?: { now(): Date };
  readonly employeeCardKey?: Buffer;
  readonly personal?: PersonalAuthentication | null;
  /** استرجاع كلمة المرور بالإيميل (spec 079 PR-b): بدون الخدمة المسار بيرد OTP_UNAVAILABLE. */
  readonly passwordReset?: PasswordResetOtpApi | null;
  /** استعادة الموظفة رقمها السري بكود (spec 079 PR-c1): بدون الخدمة المسارين بيردوا OTP_UNAVAILABLE. */
  readonly staffPinReset?: StaffPinResetApi | null;
  readonly files?: FilesRuntime | null;
  readonly staff?: {
    api: StaffOtpApi | null;
    sessions: StaffSessions | null;
    origin: string | null;
    nativeOrigins?: readonly string[];
  };
  /**
   * بوابة قدرة دخول الموظفات (spec 076 FR-F1-9): تُقرأ مرة واحدة عند التشغيل من STAFF_ACCESS_ROUTES،
   * وكل مسارات القدرة ترد 503 ما دامت مطفأة. تشغيلها قرار deploy بعد دمج PRs الخمسة كلها.
   */
  readonly staffAccessRoutes?: boolean;
  /**
   * ساعة مسار الرقم السري للموظفات: مدّة الرقم المؤقت ومدّة دليل التغيير بتتقاس بيها، والاختبار
   * يحكم في الوقت بدل ما يعدّل صفوف الجدول.
   */
  readonly staffPinClock?: Clock | undefined;
  /**
   * دعوة الأعضاء: أصل لوحة الإدارة اللي صفحة تعيين كلمة المرور بتتبني عليه، وساعة بيتقاس بيها عمر
   * الرابط (AC-G1-2). من غير الأصل مسارات الدعوة بترد NOT_READY.
   */
  readonly memberInvitations?: { readonly adminOrigin: string; readonly clock?: { now(): Date } };
  /**
   * مفتاح ختم إيميلات الترحيب: نفس مفتاح بصمة البريد في الـ worker. من غيره (أو من غير مفتاح صالح)
   * مفيش بريد ترحيب ولا بريد دعوة — والمنح نفسه بيفضل شغال.
   */
  readonly onboardingEmailKey?: string | null;
  readonly readiness: readonly ReadinessCheck[];
  /** Releases what main.ts opened (pools, clients). Runs on app.close() and on SIGTERM/SIGINT. */
  readonly onShutdown?: () => Promise<void>;
  /** Better Auth, and the public URL its routes resolve against. Without it no route but @Public() answers. */
  readonly auth?: { readonly service: AuthService; readonly baseURL: string };
  /** The tenant wrappers the access guard reads memberships through. Without them no @Require route answers. */
  readonly database?: TenantWrappers;
  /** UUID v7 for rows the use cases create; the system clock and Web Crypto unless a test injects its own. */
  readonly ids?: IdGenerator;
  /** Redis — pairing codes and rate limits. Without it those routes answer NOT_READY. */
  readonly redis?: Redis;
  /** أصول تسجيل الدخول الموثوقة لـ Better Auth ومسارات استرجاع كلمة المرور. */
  readonly authTrustedOrigins?: readonly string[];
  /** أصول المتصفح المسموح لها باستدعاء مسارات API المصادق عليها مع بيانات الاعتماد (admin وPOS). */
  readonly corsOrigins?: readonly string[];
  /** أصل صفحة التقييم العامة بالمطابقة التامة؛ مستقل عن ثقة تسجيل الدخول، والقيمة الفارغة تعطّل CORS للتقييم العام. */
  readonly ratingPageOrigin?: string;
  readonly whatsapp?: WhatsappIntake;
  /** بدون هذا الاستقبال الموقّع رد الويبيوك NOT_READY ومايتخزنش شيء. */
  readonly resend?: ResendIntake;
  /** The push public key and subject, when push is configured; without them the push routes answer NOT_READY. */
  readonly push?: PushApiConfiguration | null;
  readonly trustedProxy?: readonly string[];
}

export interface AppOptions {
  /** The shared sanitising logger — main.ts builds it from the validated LOG_LEVEL; tests pass a sink. */
  readonly logger?: Logger;
  /** Test-only: extra controllers mounted beside the real ones. */
  readonly controllers?: readonly Type<unknown>[];
}
