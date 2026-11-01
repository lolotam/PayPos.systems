import type { CommissionPlanStatementPeriod } from '../domain/plan-periods.ts';

/**
 * خطوات القفل التي تشترك فيها كاتبة إصدارات الخطة وكاتبة تجاوزات الخدمة.
 * الاختلاف بينهما في الكتابة نفسها (إصدار أو تجاوز) وفي فحص الخدمة، وباقي الخطوات واحدة.
 */
export interface CommissionInputLockScope {
  /**
   * بيقفل صف الموظفة قبل أي قراءة أو كتابة تخصها.
   *
   * @returns true عند وجود الموظفة النشطة في النشاط
   */
  lockEmployee(): Promise<boolean>;
  /**
   * بيرجّع توقيت النشاط وتاريخ إنشائه لتحديد اليوم المحلي وأول شهر يسمح به السريان.
   *
   * @returns التوقيت وتاريخ الإنشاء، أو null عند غياب النشاط
   */
  calendar(): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null>;
  /**
   * بيقفل كل الشهور المتأثرة في نداء واحد تصاعدي.
   *
   * @param periods الشهور من شهر السريان حتى الشهر الحالي
   * @returns حالات الكشوف بعد القفل
   */
  lockPeriods(periods: readonly string[]): Promise<CommissionPlanStatementPeriod[]>;
  /**
   * بيرجّع شهور REVIEWED اللاحقة إلى DRAFT ويمسح دليل مراجعتها.
   *
   * @param periods الشهور التي قررت قاعدة السريان إرجاعها
   * @returns اكتمال التحديث
   */
  reopenReviewed(periods: readonly string[]): Promise<void>;
  /**
   * بيعيد فحص صلاحية إدارة العمولات وميزة العمولات بعد انتظار أقفال الشهور.
   *
   * @returns FORBIDDEN عند سحب الصلاحية، أو FEATURE_DISABLED عند تعطيل الميزة، أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
}
