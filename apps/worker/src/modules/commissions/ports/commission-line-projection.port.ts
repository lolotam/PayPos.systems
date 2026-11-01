import type { LockedStatementPeriod, Tx } from '@pospay/db';

import type {
  CommissionLineStatus,
  HeldCommissionLineHead,
} from '../domain/commission-line-types.ts';

export interface Clock {
  /** يرجع اللحظة الحالية من مصدر محقون حتى تكون حدود الشهر قابلة للاختبار. */
  now(): Date;
}

export interface IdGenerator {
  /** يرجع UUID v7 جديداً لصفوف الكشوف التي ينشئها قفل الشهور. */
  newId(): string;
}

export type BusinessTimeZoneReader = (
  tx: Tx,
  companyId: string,
  businessId: string,
) => Promise<string | null>;

export interface CommissionLineHeadWrite {
  readonly businessId: string;
  readonly lineId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly customerId: string;
  readonly revision: number;
  readonly status: CommissionLineStatus;
  readonly businessDate: string;
  readonly period: string;
}

export interface CommissionLinePerformerWrite {
  readonly businessId: string;
  readonly lineId: string;
  readonly branchId: string;
  readonly employeeId: string;
  readonly serviceId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly businessDate: string;
  readonly period: string;
  readonly net: string;
  readonly netShare: string;
  readonly shareBps: number;
  readonly ruleKind: 'FOLLOW_PLAN' | 'ZERO' | 'PCT' | 'FIXED';
  readonly rulePctBps: number | null;
  readonly ruleFixedAmount: string | null;
  readonly counts: boolean;
  readonly status: CommissionLineStatus;
}

export interface CommissionLineReplacement {
  readonly head: CommissionLineHeadWrite;
  readonly rows: readonly CommissionLinePerformerWrite[];
}

export interface CommissionPeriodLockInput {
  readonly businessId: string;
  readonly periods: readonly string[];
  readonly affectedPeriods: readonly string[];
  readonly ids: IdGenerator;
}

export interface CommissionPeriodReopenInput {
  readonly businessId: string;
  readonly periods: readonly string[];
}

export interface CommissionLineProjectionScope {
  /**
   * يقفل هويات البنود تصاعدياً قبل قراءة مراجعاتها حتى تتسلسل الأحداث المتسابقة.
   *
   * @param lineIds هويات البنود المطلوب قفلها
   */
  lockLines(lineIds: readonly string[]): Promise<void>;
  /**
   * يرجع مراجعات وشهور الرؤوس المحفوظة بعد الأقفال لاستبعاد القديم وحساب المتأثر.
   *
   * @param lineIds هويات البنود المطلوب قراءة رؤوسها
   */
  readHeads(lineIds: readonly string[]): Promise<readonly HeldCommissionLineHead[]>;
  /**
   * يرجع منطقة النشاط لحساب الشهر الحالي، أو null عندما لا يكون النشاط موجوداً.
   *
   * @param companyId هوية الشركة صاحبة النشاط
   * @param businessId هوية النشاط المطلوب قراءة منطقته الزمنية
   */
  businessTimeZone(companyId: string, businessId: string): Promise<string | null>;
  /**
   * يقفل المتأثر والمرشحين مرة واحدة ويرفض المغلق من المتأثر قبل أي كتابة.
   *
   * @param input الشهور المتأثرة والمرشحة ومولّد هويات الكشوف الجديدة
   */
  lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedStatementPeriod[]>;
  /**
   * يستبدل رؤوس البنود وصفوف منفّذيها دفعة واحدة داخل معاملة الحدث.
   *
   * @param replacements لقطات الرؤوس وصفوف المنفّذين الأحدث
   */
  replaceLines(replacements: readonly CommissionLineReplacement[]): Promise<void>;
  /**
   * يرجع شهور REVIEWED المتأثرة فقط إلى DRAFT مع مسح دليل المراجعة.
   *
   * @param input النشاط والشهور المتأثرة المطلوب إعادة فتحها
   */
  reopenReviewed(input: CommissionPeriodReopenInput): Promise<void>;
}
