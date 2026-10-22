import type { AlertKind, EffectiveAlertRule } from '@pospay/domain';

/** القاعدة الفعلية لنوع تنبيه واحد؛ الجرس بياخد منها المستلمين بالدور والقناة اللي بيوصلهم. */
export interface AlertRulesPort {
  /**
   * يرجع القاعدة الفعلية لنوع تنبيه في نطاق نشاط وفرع، بالمفتاح العام مطبّق.
   *
   * @param companyId الشركة من الغلاف الموثوق
   * @param scope نشاط الحدث وفرعه
   * @param scope.businessId نشاط الحدث
   * @param scope.branchId فرع الحدث أو null
   * @param kind نوع التنبيه
   * @returns القاعدة الفعلية؛ المقفولة مفيش منها مستلمين ولا قنوات
   */
  rule(
    companyId: string,
    scope: { businessId: string; branchId: string | null },
    kind: AlertKind,
  ): Promise<EffectiveAlertRule>;
}
