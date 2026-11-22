import type { CommissionPlanVersion, CreateCommissionPeriodRepairInput } from '@pospay/contracts';
import type { CommissionCorrectionScope } from '@pospay/commissions-posting';

import type { CommissionInputLockScope } from './commission-input-lock-scope.port.ts';
import type { CommissionPlanVersionActor } from './commission-plan-version-transactions.port.ts';

/** طلب إصلاح شهر بهوية الفاعل والمفتاح والبصمة، لأن إعادة الإرسال لازم تتفرّق بين نفس الطلب وطلب مختلف بنفس المفتاح. */
export interface CommissionPeriodRepairCommand extends CommissionPlanVersionActor {
  readonly input: CreateCommissionPeriodRepairInput;
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
   * بيقرأ التصحيح الموقوف المفتوح للموظفة في شهر المصدر، بعد أقفال الشهور.
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
  insert(record: CommissionPlanVersion): Promise<CommissionPlanVersion>;
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
  audit(record: CommissionPlanVersion, block: CommissionRepairBlockState): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال لإصلاح الشهر. */
export interface CommissionPeriodRepairTransactions {
  /**
   * ينفذ الأقفال والتحقق والكتابة والتصحيح والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
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
