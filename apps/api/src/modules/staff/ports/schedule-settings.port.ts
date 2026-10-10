import type { ScheduleActor } from './schedules.port.ts';

/** حالة الإعداد الفعلية؛ الصف الغائب يعرض القيمة الافتراضية دون كتابة. */
export interface ScheduleSettingsRecord {
  business_id: string;
  max_shifts_per_day: number;
  is_default: boolean;
  updated_at: string | null;
}
/** القيمة الخاصة منفصلة عن الموروثة حتى لا يعتبر حفظ القيمة الموروثة تكراراً. */
export interface BranchScheduleSettingsRecord {
  business_id: string;
  branch_id: string;
  max_shifts_per_day: number | null;
  business_value: number | null;
  updated_at: string | null;
}
/** عمليات إعداد الورديات ضمن نفس معاملة الشركة والتدقيق. */
export interface ScheduleSettingsScope {
  /**
   * يثبت أن الفرع نشط ويتبع النشاط بعد تثبيت إذن إعداداته.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع المطلوب
   */
  branch(businessId: string, branchId: string): Promise<void>;
  /**
   * يقفل إعداد الفرع ويعيد قيمة النشاط للمقارنة والاستجابة الموروثة.
   *
   * @param businessId النشاط المتحقق منه
   * @param branchId الفرع المطلوب
   */
  branchSettings(businessId: string, branchId: string): Promise<BranchScheduleSettingsRecord>;
  /**
   * يحفظ القيمة الخاصة وتدقيقها في نفس المعاملة دون لمس الجداول.
   *
   * @param before القيمة السابقة للتدقيق
   * @param after القيمة الجديدة
   */
  saveBranch(
    before: BranchScheduleSettingsRecord,
    after: BranchScheduleSettingsRecord,
  ): Promise<void>;
  /**
   * يحذف القيمة الخاصة ويدقق الرجوع إلى النشاط في نفس المعاملة.
   *
   * @param before القيمة السابقة للتدقيق
   */
  clearBranch(before: BranchScheduleSettingsRecord): Promise<void>;
  /**
   * يثبت صلاحية إعداد النشاط والميزة بعد قفل الشركة والعضويات.
   *
   * @param businessId النشاط المتحقق منه
   */
  authorize(businessId: string): Promise<void>;
  /**
   * يقفل الصف إن وجد ويعيد القيمة الفعلية لمقارنة التغيير.
   *
   * @param businessId النشاط المتحقق منه
   */
  settings(businessId: string): Promise<ScheduleSettingsRecord>;
  /**
   * يحفظ التغيير وتدقيقه معاً دون تغيير أي جدول أو قالب.
   *
   * @param before القيمة السابقة للتدقيق
   * @param after القيمة الجديدة
   */
  save(before: ScheduleSettingsRecord, after: ScheduleSettingsRecord): Promise<void>;
}
/** حد المعاملة يمنع تداخل خفض الحد مع كتابة ورديات جديدة. */
export interface ScheduleSettingsTransactions {
  /**
   * يحتفظ بأقفال الشركة والإعداد حتى اكتمال التغيير والتدقيق.
   *
   * @param actor الفاعل والشركة المختارة
   * @param work العمل ضمن نفس المعاملة
   */
  run<T>(actor: ScheduleActor, work: (scope: ScheduleSettingsScope) => Promise<T>): Promise<T>;
}
