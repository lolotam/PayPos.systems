import type { WorkspaceCompany } from '@pospay/contracts';

/** تلميحات نطاق ids-only من روابط التبويب الجديد — بلا أسماء أو تليفونات أو PII. */
export interface ScopeHint {
  companyId?: string | undefined;
  businessId?: string | undefined;
  branchId?: string | undefined;
}

export interface ResolvedScopeHint {
  /** في تلميح موجود في العنوان أصلًا. */
  readonly hinted: boolean;
  /** التلميح بيطابق أعضاء الجلسة الحاليين، فمفيش رفض ولا تبديل مطلوب. */
  readonly matches: boolean;
  /** التلميح بيطابق خيارات متاحة للجلسة (يصلح التبديل بإرادة المستخدم) — من غير أي منح من العنوان. */
  readonly known: boolean;
  readonly choice: { companyId: string; businessId: string; branchId: string } | null;
}

/**
 * بيفك تلميح النطاق ضد قايمة شركات الجلسة نفسها (كل شركة بنشاطاتها وفروعها) ويقارنه بالاختيار الحالي:
 * التطابق يعني متابعة عادية، والمعلوم غير المتطابق يصلح تبديلًا بإرادة المستخدم، والمجهول رفض صريح.
 * الرابط لا يمنح أي صلاحية — الخادم بيجدد الترخيص على كل طلب.
 */
export function resolveScopeHint(
  hint: ScopeHint,
  companies: readonly WorkspaceCompany[],
  current: {
    company: string | undefined;
    business: string | undefined;
    branch: string | undefined;
  },
): ResolvedScopeHint {
  const hinted =
    hint.companyId !== undefined || hint.businessId !== undefined || hint.branchId !== undefined;
  if (!hinted) return { hinted: false, matches: true, known: false, choice: null };
  const company = companies.find((candidate) => candidate.id === hint.companyId);
  const business = company?.businesses.find((candidate) => candidate.id === hint.businessId);
  const branch = business?.branches.find((candidate) => candidate.id === hint.branchId);
  const known = company !== undefined && business !== undefined && branch !== undefined;
  const choice = known
    ? { companyId: company.id, businessId: business.id, branchId: branch.id }
    : null;
  const matches =
    known &&
    current.company === company?.id &&
    current.business === business?.id &&
    current.branch === branch?.id;
  return { hinted: true, matches, known, choice };
}
