import type { Tx } from '@pospay/db';

import type {
  CommissionStatementReturnRecord,
  CommissionStatementReturnTransition,
} from '../domain/statement-return-plan.ts';
import type { CommissionStatementReviewTransition } from '../domain/statement-review-plan.ts';
import type { StatementFingerprints } from '../domain/statement-change-cause.ts';
import type { CommissionStatementSource } from './commission-statement.port.ts';

/** طلب مراجعة كشف شهر: البصمتان اللي المراجع شافهما في العرض (FR-029). */
export interface CommissionStatementReviewCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly expectedFingerprint: string;
  readonly expectedStatementFingerprint: string;
}

/** طلب إرجاع كشف مراجَع للمسودة: السبب (FR-031). */
export interface CommissionStatementReturnCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly reason: string;
}

/**
 * خطوات الكتابة على معاملة شركة واحدة للمراجعة والإرجاع معاً: التوقيت، وقفل الشهر، وإعادة فحص
 * الصلاحية بعد القفل، وقراءة المصادر، وتخزين الحالة، والتدقيق، وإشعار الاعتماد.
 */
export interface CommissionStatementReviewScope {
  /**
   * بيرجّع توقيت النشاط لتحديد اليوم المحلي اللي عليه نقرر انتهاء الشهر.
   *
   * @returns التوقيت، أو null عند غياب النشاط
   */
  timeZone(): Promise<string | null>;
  /**
   * بيقفل كشف الشهر في نداء واحد بعد ما ينشئ صف DRAFT لو مش موجود، ويرفض APPROVED وPAID.
   *
   * @param period الشهر المطلوب
   * @returns اكتمال القفل وفحص الشهر المفتوح
   */
  lockPeriod(period: string): Promise<void>;
  /**
   * بيرجّع معرّف صف الكشف المقفول وقت القفل؛ من غير قفل بيرجع صف غلط أو مفيش صف.
   *
   * @returns معرّف صف الكشف المقفول
   */
  lockedStatementId(): string;
  /**
   * بيعيد فحص الصلاحية بعد الأقفال: «المراجعة» للمراجعة و«المراجعة أو الاعتماد» للإرجاع.
   *
   * @returns FORBIDDEN أو FEATURE_DISABLED أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * بيقرا مصادر الكشف بعد القفل، في نفس معاملة الكتابة.
   *
   * @param period الشهر المطلوب
   * @returns مصادر الكشف
   */
  readSource(period: string): Promise<CommissionStatementSource>;
  /**
   * بيرجّع عضوية الفاعل السارية عشان تتسجل مع المراجعة أو الإرجاع (FR-029، FR-031).
   *
   * @returns معرّف العضوية، أو null لما مفيش عضوية سارية
   */
  actorMembership(): Promise<string | null>;
  /**
   * بيخزّن حالة REVIEWED ببصمتيها والمراجع ووقته على صف الكشف المقفول.
   *
   * @param period الشهر المطلوب
   * @param transition انتقال الحالة وبصمتاها والمراجع
   * @returns اكتمال التحديث
   */
  storeReview(period: string, transition: CommissionStatementReviewTransition): Promise<void>;
  /**
   * بيرجّع الكشف المراجَع لمسودة ويمسح حقائق المراجعة الخمس.
   *
   * @param period الشهر المطلوب
   * @param transition انتقال الحالة وحقائق المراجعة الممسوحة
   * @returns اكتمال التحديث
   */
  storeReturn(period: string, transition: CommissionStatementReturnTransition): Promise<void>;
  /**
   * بيكتب سطر الإرجاع بالسبب؛ السبب يعيش في السطر ده وحده (FR-031، قاعدة spec 055 D-7).
   *
   * @param record سطر الإرجاع: الكشف والفاعل والسبب والوقت
   * @returns اكتمال الكتابة
   */
  storeReturnRecord(record: CommissionStatementReturnRecord): Promise<void>;
  /**
   * بيكتب تدقيق `commission_statement.reviewed` بالبصمتين ومن غير أي مبلغ ولا اسم.
   *
   * @param period الشهر المطلوب
   * @param fingerprints بصمتا المدخلات والكشف اللي اتراجعوا
   * @returns اكتمال التدقيق
   */
  auditReview(period: string, fingerprints: StatementFingerprints): Promise<void>;
  /**
   * بيكتب تدقيق `commission_statement.returned` من غير السبب؛ السبب مش بيدخل نص التدقيق.
   *
   * @param period الشهر المطلوب
   * @returns اكتمال التدقيق
   */
  auditReturn(period: string): Promise<void>;
  /**
   * يبني مجموعات مستلمي إشعار «الكشف مستني الاعتماد» ويكتبها في نفس معاملة المراجعة (FR-030).
   *
   * @param period الشهر المطلوب
   * @param businessId النشاط المطلوب
   * @returns اكتمال الكتابة
   */
  notifyApprovers(period: string, businessId: string): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال للمراجعة والإرجاع. */
export interface CommissionStatementReviewTransactions {
  /**
   * ينفذ قفل الشهر والمراجعة والتدقيق وإشعار الاعتماد مع مطالبة idempotent في معاملة شركة واحدة.
   * لو انتهى انتظار المطالبة بخطأ الانشغال فالمعاملة بتتلغي وبتتقرا الصلاحية مرة كمان في معاملة
   * منفصلة قبل الرد.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال والبصمتان المتوقعتان
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزّن
   */
  run<T>(
    command: CommissionStatementReviewCommand,
    work: (scope: CommissionStatementReviewScope) => Promise<T>,
  ): Promise<T>;
  /**
   * ينفذ قفل الشهر والإرجاع وسطر الإرجاع والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال والسبب
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزّن
   */
  runReturn<T>(
    command: CommissionStatementReturnCommand,
    work: (scope: CommissionStatementReviewScope) => Promise<T>,
  ): Promise<T>;
}

/**
 * قارئ أصحاب صلاحية الاعتماد: المستلمون الفعليون لإشعار «الكشف مستني الاعتماد» وقت الحدث.
 */
export type CommissionApproversReader = (
  tx: Tx,
  companyId: string,
  businessId: string,
) => Promise<readonly string[]>;

/**
 * قارئ عضوية الفاعل: العضوية السارية اللي بتدي الفاعل سلطته على النشاط المطلوب (نطاق شركة أو
 * نطاق النشاط ده)، وهي اللي بتتسجل مع المراجعة أو الإرجاع.
 */
export type CommissionActorMembershipReader = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
) => Promise<string | null>;
