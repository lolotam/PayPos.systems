import { evaluateAccess, type AccessGrant, type ScopeType } from './access.ts';
import { RATINGS_READ_PERMISSION, RATINGS_READ_ROLES } from './ratings-read-eligibility.ts';

/** عضوية سارية للمستخدم: نطاقها وكود دورها النظامي، أو null لدور مخصص من الشركة. */
export interface RatingsReadMembership {
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly systemRoleCode: string | null;
}

/** الشركة والنشاط المطلوب قراءة تقييماتهم. */
export interface RatingsReadScope {
  readonly companyId: string;
  readonly businessId: string;
}

/**
 * بيحدد فروع النشاط اللي المستخدم يقدر يقرأ تقييماتها الآن (FR-B15).
 * الفرع مسموح بس لو في عضوية سارية دورها النظامي الحالي أحد المديرين الأربعة وتغطي الفرع، وكمان الصلاحية فعّالة عنده
 * بقاعدة المنع قبل السماح؛ كده منحة قديمة فاضلة على عضوية اتغيّر دورها لكاشير ما بتفتحش أي فرع.
 *
 * @param scope     الشركة والنشاط المطلوب قراءة تقييماتهم
 * @param branchIds كل فروع النشاط
 * @param members   العضويات السارية للمستخدم بأكواد أدوارها الحالية
 * @param grants    منح المستخدم في الشركة بالـ DENY بتاعتها
 * @returns الفروع المسموحة بترتيب المدخل، وفاضية لو مفيش فرع مسموح
 */
export function readableRatingBranches(
  scope: RatingsReadScope,
  branchIds: readonly string[],
  members: readonly RatingsReadMembership[],
  grants: readonly AccessGrant[],
): readonly string[] {
  const managers = members.filter(
    (m) => m.systemRoleCode !== null && RATINGS_READ_ROLES.includes(m.systemRoleCode),
  );
  return branchIds.filter((branchId) => {
    const covered = managers.some(
      (m) =>
        (m.scopeType === 'COMPANY' && m.scopeId === scope.companyId) ||
        (m.scopeType === 'BUSINESS' && m.scopeId === scope.businessId) ||
        (m.scopeType === 'BRANCH' && m.scopeId === branchId),
    );
    return covered && evaluateAccess(grants, RATINGS_READ_PERMISSION, { ...scope, branchId });
  });
}
