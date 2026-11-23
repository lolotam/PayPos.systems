import type { CommissionPlanWire } from '@pospay/commissions-engine';
import type { CommissionCorrectionScope } from '@pospay/commissions-posting';

import type { OutboxWriter } from '../../../shared/ports/outbox-writer.port.ts';
import type { CommissionInputLockScope } from './commission-input-lock-scope.port.ts';
import type { CommissionPlanVersionActor } from './commission-plan-version-transactions.port.ts';

/** جسم طلب الإصلاح: الشهر المحجوز والخطة بصيغة العقد، وطبقة http هي اللي بتحوّل من DTO العقد لهنا. */
export interface CommissionPeriodRepairInput {
  readonly period: string;
  readonly plan: CommissionPlanWire;
}

/** إصدار الإصلاح كما يُخزَّن ويُرجَع: الخطة بصيغة العقد مع هويته وتاريخ سريانه وشهر الإصلاح. */
export interface CommissionRepairVersion extends CommissionPlanWire {
  readonly id: string;
  readonly employee_id: string;
  readonly version: number;
  readonly effective_from: string;
  readonly whole_period: boolean;
  readonly repair_period: string | null;
  readonly created_at: string;
  readonly created_by: string;
}

/** نتيجة الإصلاح: الإصدار المخزّن وحالة التصحيح الموقوف بعده. */
export interface CommissionPeriodRepairResult {
  readonly version: CommissionRepairVersion;
  readonly blocked_correction: CommissionRepairBlockState;
}

/** طلب إصلاح شهر بهوية الفاعل والمفتاح والبصمة، لأن إعادة الإرسال لازم تتفرّق بين نفس الطلب وطلب مختلف بنفس المفتاح. */
export interface CommissionPeriodRepairCommand extends CommissionPlanVersionActor {
  readonly input: CommissionPeriodRepairInput;
  readonly key: string;
  readonly fingerprint: string;
}

/** التصحيح الموقوف المفتوح للموظفة والشهر: هويته وكوده، والحدث الأول اللي سجّله (بيحمله الإصلاح كـ event_id لتصحيحاته). */
export interface CommissionRepairOpenBlock {
  readonly id: string;
  readonly code: 'NO_PLAN' | 'NO_SALARY';
  readonly firstEventId: string;
}

/** حالة التصحيح الموقوف بعد الإصلاح، بشكل الرد. */
export interface CommissionRepairBlockState {
  readonly id: string;
  readonly code: 'NO_PLAN' | 'NO_SALARY';
  readonly resolved: boolean;
}

/** خطوات الكتابة اللي بتحتاجها حالة استخدام الإصلاح جوّه معاملة شركة واحدة. */
export interface CommissionPeriodRepairScope extends CommissionInputLockScope {
  /**
   * بيقرأ أعلى رقم إصدار للموظفة بعد قفل صفها، والإصلاح بياخد الرقم اللي بعده.
   *
   * @returns أعلى رقم أو null لأول إصدار
   */
  latestVersion(): Promise<number | null>;
  /**
   * بيقرأ التصحيح الموقوف المفتوح للموظفة في شهر المصدر تحت أقفال الشهور: دي القراءة الوحيدة اللي بتقرر السماح بالإصلاح، ومفيش قراءة قبل الأقفال.
   *
   * @param period شهر المصدر YYYY-MM
   * @returns الصف المفتوح أو null لو مفيش
   */
  readOpenBlock(period: string): Promise<CommissionRepairOpenBlock | null>;
  /**
   * بيدخل إصدار الإصلاح ويرجّع الصف كما خزّنته قاعدة البيانات بشكل العقد.
   *
   * @param record الإصدار كامل المعرف والتوقيت وشهر الإصلاح
   * @returns الصف المخزن
   */
  insert(record: CommissionRepairVersion): Promise<CommissionRepairVersion>;
  /**
   * بيرجّع نطاق خطوة التصحيح المربوط بنفس المعاملة، علشان الإصلاح والتصحيحات ينجحوا أو يتلغوا معاً.
   *
   * @returns نطاق التصحيح لمعاملة الإصلاح
   */
  corrections(): CommissionCorrectionScope;
  /**
   * بيقرأ حالة التصحيح الموقوف بعد الخطوة: محلول، أو اتبدّل كوده لـ NO_SALARY، أو لسه NO_PLAN.
   *
   * @param blockId هوية التصحيح الموقوف
   * @returns الهوية والكود وهل اتحلّ
   */
  readBlock(blockId: string): Promise<CommissionRepairBlockState>;
  /**
   * بيكتب تدقيق الإصلاح (commission_plan.period_repaired) بالخطة وحالة التصحيح بس، من غير راتب أو بيانات حساسة.
   *
   * @param record الصف المخزن اللي بيوثقه الإدخال
   * @param block حالة التصحيح الموقوف بعد الإصلاح
   * @returns اكتمال التدقيق
   */
  audit(record: CommissionRepairVersion, block: CommissionRepairBlockState): Promise<void>;
  /** كاتب الـ outbox المربوط بنفس المعاملة، لحدث حفظ الإصلاح اللي بيطلع مع الكتابات أو بيتلغى معاها. */
  readonly outbox: OutboxWriter;
}

/** حد المعاملة الذرية وإعادة الإرسال لإصلاح الشهر. */
export interface CommissionPeriodRepairTransactions {
  /**
   * ينفذ الأقفال والتحقق والكتابة والتصحيح والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
   * لو انتهى انتظار المطالبة بخطأ الانشغال فالمعاملة بتتلغي، وبتتقرا الصلاحية مرة كمان في معاملة منفصلة قبل الرد.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزّن
   */
  run<T>(
    command: CommissionPeriodRepairCommand,
    work: (scope: CommissionPeriodRepairScope) => Promise<T>,
  ): Promise<T>;
}
