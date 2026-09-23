import type { AccessGrant, ScopeType } from '../domain/access.ts';

/**
 * نطاق عضوية واحدة سارية للمستخدم في الشركة.
 */
export interface ActiveMembership {
  readonly scopeType: ScopeType;
  readonly scopeId: string;
}

/**
 * صلاحية ومعاها مصدرها — role العضوية ولا override — عشان الـ principal يوضّح جات منين.
 */
export interface SourcedGrant extends AccessGrant {
  readonly source: 'role' | 'override';
}

/**
 * اللي الـ guard محتاج يقراه عشان يقرر — كل method بتقرا في الطلب نفسه، مفيش cache.
 */
export interface AccessReader {
  /**
   * الشركات اللي المستخدم ليه فيها عضوية سارية دلوقتي — بتتقري تحت withUser قبل ما أي tenant يتفتح.
   *
   * @param userId المستخدم اللي الـ session اتأكدت له
   */
  companiesOf(userId: string): Promise<readonly string[]>;
  /**
   * العضويات السارية والصلاحيات (role + overrides بالـ DENY) للمستخدم في الشركة دي — بعد ما عضويته اتأكدت.
   *
   * @param companyId الشركة اللي عضويته فيها اتأكدت
   * @param userId    المستخدم
   */
  accessIn(
    companyId: string,
    userId: string,
  ): Promise<{ memberships: readonly ActiveMembership[]; grants: readonly SourcedGrant[] }>;
  /**
   * الـ business بتاع الفرع في الشركة دي، أو null لو الفرع مش موجود فيها — عشان تقييم نطاق الـ business.
   *
   * @param companyId الشركة المتأكد منها
   * @param branchId  الفرع اللي الـ route بيلمسه
   */
  businessOfBranch(companyId: string, branchId: string): Promise<string | null>;
  /**
   * هل الـ business ده موجود في الشركة دي — عشان business شركة تانية يترفض قبل تقييم الصلاحية (TEN-03).
   *
   * @param companyId الشركة المتأكد منها
   * @param businessId الـ business اللي الـ route بيلمسه
   */
  businessInCompany(companyId: string, businessId: string): Promise<boolean>;
  /**
   * هل الـ feature مفعّلة للشركة: override ساري لو موجود، وإلا flag الـ plan، وإلا مقفولة.
   *
   * @param companyId الشركة المتأكد منها
   * @param flag      اسم الـ feature flag
   */
  isFeatureEnabled(companyId: string, flag: string): Promise<boolean>;
}
