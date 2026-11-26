import type { Tx } from '@pospay/db';

import { businessNamesByIds, businessCountry, describeWorkspaces } from '../../tenancy/index.ts';

/** اسم النشاط كما بيجي من موديول tenancy: العربي اختياري والإنجليزي لازم. */
export interface WorkspaceNames {
  readonly name_ar: string | null;
  readonly name_en: string;
}

/** أسماء أنشطة الملاحظات: قراءة واحدة لكل النشاطات المطلوبة، مش قراءة لكل ملاحظة. */
export interface WorkspaceNamesReader {
  names(
    tx: Tx,
    companyId: string,
    businessIds: readonly string[],
  ): Promise<ReadonlyMap<string, WorkspaceNames>>;
}

/** تحويل الفرع إلى النشاط اللي بيخدمه؛ الحارس أثبت إن الفرع في الشركة. */
export interface BranchBusinessReader {
  business(tx: Tx, branchId: string): Promise<string>;
}

export const workspaceNames: WorkspaceNamesReader = {
  names: async (tx, companyId, businessIds) => {
    if (businessIds.length === 0) return new Map<string, WorkspaceNames>();
    const rows = await businessNamesByIds(tx, companyId, businessIds);
    return new Map(rows.map((row) => [row.id, { name_ar: row.name_ar, name_en: row.name_en }]));
  },
};

export const branchBusiness: BranchBusinessReader = {
  business: async (tx, branchId) => {
    const workspaces = await describeWorkspaces(tx, [{ scope: 'BRANCH', scopeId: branchId }]);
    const business = workspaces?.businesses[0];
    if (business === undefined) throw new Error('BRANCH_WITHOUT_BUSINESS');
    return business.id;
  },
};

/**
 * يحل نطاق الاستيراد إلى نشاطه ودولة النشاط؛ null للنطاق الغائب أو الخارج عن الشركة.
 *
 * @param tx معاملة المستأجر الجارية
 * @param companyId الشركة مالكة النشاط
 * @param scope النطاق المستهدف: نشاط أو فرع
 * @returns النشاط ودولته أو null
 */
export async function readCustomerImportScope(
  tx: Tx,
  companyId: string,
  scope: { readonly kind: 'business' | 'branch'; readonly id: string },
): Promise<{ readonly businessId: string; readonly countryCode: string | null } | null> {
  const workspaces = await describeWorkspaces(tx, [
    { scope: scope.kind === 'business' ? 'BUSINESS' : 'BRANCH', scopeId: scope.id },
  ]);
  const businessId = workspaces?.businesses[0]?.id ?? null;
  if (businessId === null) return null;
  const country = await businessCountry(tx, companyId, businessId);
  return { businessId, countryCode: country?.country ?? null };
}
