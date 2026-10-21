import type { AlertKind, AlertRuleSettings } from '@pospay/domain';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** نطاق قاعدة: النشاط، أو فرع منه بيغيّر قاعدة النشاط (AL-Q2). */
export interface AlertRuleTarget {
  readonly businessId: string;
  readonly branchId: string | null;
}

/** قاعدة مخزنة لنوع واحد في نطاق واحد. */
export interface StoredAlertRule extends AlertRuleSettings {
  readonly kind: AlertKind;
  readonly revision: number;
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
   */
  lockRules(target: AlertRuleTarget): Promise<ReadonlyMap<AlertKind, StoredAlertRule>>;
  /**
   * بيكتب قاعدة نوع واحد في النطاق (بيعملها لو مش موجودة) ويزوّد الـ revision.
   *
   * @param target    النشاط والفرع
   * @param kind      النوع
   * @param settings  القيم الجديدة
   * @param updatedBy المستخدم اللي غيّر
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
   */
  deleteBranchRule(
    target: AlertRuleTarget & { readonly branchId: string },
    kind: AlertKind,
  ): Promise<StoredAlertRule | null>;
  /**
   * المفتاح العام المخزن مقفول (null = شغّال، أو مفيش صف إعدادات لسه).
   *
   * @param businessId النشاط
   */
  lockMaster(businessId: string): Promise<boolean | null>;
  /**
   * بيكتب المفتاح العام للنشاط (بيعمل صف الإعدادات لو مش موجود).
   *
   * @param businessId النشاط
   * @param enabled    القيمة الجديدة
   * @param updatedBy  المستخدم اللي غيّر
   */
  saveMaster(businessId: string, enabled: boolean, updatedBy: string): Promise<void>;
}

/**
 * بيفتح withTenant للشركة المتأكد منها حوالين شغل قواعد التنبيه.
 */
export interface AlertRulesTransactions {
  /**
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيغيّر
   * @param work      الشغل جوه الـ transaction
   */
  run<T>(
    companyId: string,
    userId: string,
    work: (scope: AlertRulesScope) => Promise<T>,
  ): Promise<T>;
}
