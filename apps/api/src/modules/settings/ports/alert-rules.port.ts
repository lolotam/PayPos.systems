import type { Tx } from '@pospay/db';
import type { AlertKind, AlertRuleSettings } from '@pospay/domain';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** نطاق قاعدة: النشاط، أو فرع منه بيغيّر قاعدة النشاط (AL-Q2). */
export interface AlertRuleTarget {
  readonly businessId: string;
  readonly branchId: string | null;
}

/** قاعدة مخزنة لنوع واحد في نطاق واحد؛ الـ id معرّف الصف الثابت (صف اتمسح واتعمل من جديد ليه id تاني). */
export interface StoredAlertRule extends AlertRuleSettings {
  readonly id: string;
  readonly kind: AlertKind;
  readonly revision: number;
}

/**
 * لقطة القواعد المخزنة في لحظة واحدة: المفتاح العام وقواعد النشاط وقواعد الفرع.
 * الـ branchId في كل سطر هو النطاق اللي اتخزنت فيه القاعدة (null = قاعدة النشاط).
 */
export interface AlertRulesSnapshot {
  readonly alertsEnabled: boolean | null;
  readonly rules: readonly (StoredAlertRule & { readonly branchId: string | null })[];
}

/**
 * قرار قراية قواعد فرع: نفس قرار الكتابة (النشاط كله والفرع) بس من غير أقفال، على معاملة القراية نفسها.
 */
export interface AlertRulesReadAccess {
  /**
   * بيقرر `manage:settings:business` على النشاط كله وعلى الفرع ليه، عشان شاشة الفرع ما تقرايش قاعدة مش مسموحة.
   *
   * @param tx        معاملة الشركة
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيقرا
   * @param target    النشاط والفرع
   * @param target.businessId النشاط
   * @param target.branchId   الفرع
   * @returns FORBIDDEN أو null عند السماح
   */
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    target: { businessId: string; branchId: string },
  ): Promise<'FORBIDDEN' | null>;
}

/**
 * القرايات والكتابات بتاعة قواعد التنبيه جوه transaction واحدة في الشركة.
 */
export interface AlertRulesScope {
  readonly audit: AuditTrail;
  /**
   * بيقفل الشركة والعضويات والنشاط والفرع ويقرر `manage:settings:business` على النشاط كله (وعلى الفرع لقاعدته).
   *
   * @param target النشاط والفرع
   * @returns FORBIDDEN أو null عند السماح
   */
  access(target: AlertRuleTarget): Promise<'FORBIDDEN' | null>;
  /**
   * القواعد المخزنة للنطاق ده بالظبط، مقفولة لحد آخر الـ transaction عشان التدقيق يسجل قبل وبعد صح.
   *
   * @param target النشاط والفرع
   * @returns القواعد المخزنة حسب النوع
   */
  lockRules(target: AlertRuleTarget): Promise<ReadonlyMap<AlertKind, StoredAlertRule>>;
  /**
   * لقطة القواعد المخزنة والمفتاح العام على نفس الـ transaction، عشان الرد يطلع من نفس اللحظة اللي الكُتابة فيه.
   *
   * @param target النشاط والفرع
   * @returns المفتاح العام وقواعد النشاط وقواعد الفرع المخزنة
   */
  snapshot(target: AlertRuleTarget): Promise<AlertRulesSnapshot>;
  /**
   * بيكتب قاعدة نوع واحد في النطاق (بيعملها لو مش موجودة) ويزوّد الـ revision.
   *
   * @param target    النشاط والفرع
   * @param kind      النوع
   * @param settings  القيم الجديدة
   * @param updatedBy المستخدم اللي غيّر
   * @returns القاعدة بعد الحفظ بالـ revision الجديد
   */
  saveRule(
    target: AlertRuleTarget,
    kind: AlertKind,
    settings: AlertRuleSettings,
    updatedBy: string,
  ): Promise<StoredAlertRule>;
  /**
   * بيمسح قاعدة فرع لنوع واحد فالفرع يرجع لقاعدة النشاط؛ بيرجّع اللي اتمسح أو null لو مكانش فيه.
   *
   * @param target النشاط والفرع (الفرع مطلوب)
   * @param kind   النوع
   * @returns القاعدة اللي اتمسحت أو null
   */
  deleteBranchRule(
    target: AlertRuleTarget & { readonly branchId: string },
    kind: AlertKind,
  ): Promise<StoredAlertRule | null>;
  /**
   * المفتاح العام المخزن مقفول (null = شغّال، أو مفيش صف إعدادات لسه).
   *
   * @param businessId النشاط
   * @returns القيمة المخزنة؛ null = شغّال
   */
  lockMaster(businessId: string): Promise<boolean | null>;
  /**
   * بيكتب المفتاح العام للنشاط بعد lockMaster. مابيلمسش updated_at بتاع الإعدادات المتخزنة في الـ cache؛ مين ومتى في التدقيق.
   *
   * @param businessId النشاط
   * @param enabled    القيمة الجديدة
   * @returns بيخلص لما القيمة تتكتب
   */
  saveMaster(businessId: string, enabled: boolean): Promise<void>;
}

/**
 * بيفتح withTenant للشركة المتأكد منها حوالين شغل قواعد التنبيه.
 */
export interface AlertRulesTransactions {
  /**
   * بيشغّل شغل القواعد كله في transaction واحدة للشركة، عشان القفل والقرار والكتابة والتدقيق يتعملوا سوا أو يترجعوا سوا.
   *
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيغيّر
   * @param work      الشغل جوه الـ transaction
   * @returns اللي الشغل رجّعه بعد الـ commit
   */
  run<T>(
    companyId: string,
    userId: string,
    work: (scope: AlertRulesScope) => Promise<T>,
  ): Promise<T>;
}
