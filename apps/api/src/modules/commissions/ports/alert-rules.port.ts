import type { Tx } from '@pospay/db';
import type { AlertKind, EffectiveAlertRule } from '@pospay/domain';

/**
 * قواعد التنبيه اللي settings صاحبه، بتتقري جوه معاملة المُرسِل نفسها (spec 060 D-B13، FR-B17).
 * موديول العمولات بياخد منها تشغيل النوع وقناته بس؛ مستلمو «الكشف مستني الاعتماد» بيجوا من
 * صلاحية الاعتماد مش من أدوار القاعدة (DR-008، CS-Q52 = PP-227).
 */
export interface AlertRulesPort {
  /**
   * القاعدة الفعلية لنوع واحد في نطاق الحدث، بالمفتاح العام مطبّق: قاعدة الفرع لو الحدث ليه فرع وفيه قاعدة،
   * وإلا قاعدة النشاط، وإلا الافتراضي. المُرسِل بيحتاجها عشان يعرف هل النوع شغّال وبأي قناة قبل ما يبعت.
   *
   * @param tx        معاملة الشركة بتاعة المُرسِل
   * @param companyId الشركة
   * @param scope     نشاط الحدث وفرعه
   * @param scope.businessId نشاط الحدث
   * @param scope.branchId   فرع الحدث أو null
   * @param kind      نوع التنبيه
   * @returns القاعدة الفعلية؛ المقفولة ماعندهاش مستلمين ولا قنوات
   */
  rule(
    tx: Tx,
    companyId: string,
    scope: { businessId: string; branchId: string | null },
    kind: AlertKind,
  ): Promise<EffectiveAlertRule>;
}
