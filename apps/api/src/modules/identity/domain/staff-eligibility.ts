import { evaluateAccess, type AccessGrant, type AccessTarget } from './access.ts';

/**
 * لا تكفي العضوية وحدها للدخول من جهاز مشترك؛ يلزم السماح الصريح ويكسب المنع.
 *
 * @param memberships العضويات النشطة في شركة الجهاز
 * @param grants الصلاحيات الفعالة بالمنع كما هو
 * @param target نطاق الجهاز المثبت
 * @returns هل توجد عضوية تغطي الجهاز وتصريح صريح للدخول
 */
export function staffEligible(
  memberships: readonly { scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH'; scopeId: string }[],
  grants: readonly AccessGrant[],
  target: AccessTarget,
): boolean {
  const covering = memberships.some((m) =>
    m.scopeType === 'COMPANY'
      ? m.scopeId === target.companyId
      : m.scopeType === 'BUSINESS'
        ? m.scopeId === target.businessId
        : m.scopeId === target.branchId,
  );
  return covering && evaluateAccess(grants, 'login:staff:branch', target);
}
