import type { WorkspaceBusinessRead, WorkspaceCompanyRead } from '@pospay/contracts';

/**
 * أوسع وصول اليوزر على النشاط المختار: نطاق النشاط نفسه لما رد API بيبعته، وإلا نطاق
 * الشركة (رد API أقدم ما بيبعتهاش). النشاط اللي اليوزر وصله عن طريق فرع بس بيطلع BRANCH،
 * فالشاشة تفتح على الفرع بدل «كل النشاط» اللي استعلامه بيرد 403.
 *
 * @param business     النشاط المختار من مساحة العمل
 * @param companyScope أوسع عضوية اليوزر في الشركة
 * @returns أوسع وصول اليوزر على النشاط ده
 */
export function businessScope(
  business: WorkspaceBusinessRead,
  companyScope: WorkspaceCompanyRead['scope'],
): WorkspaceCompanyRead['scope'] {
  return business.scope ?? companyScope;
}
