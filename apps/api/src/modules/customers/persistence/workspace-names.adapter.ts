import type { Tx } from '@pospay/db';

import { businessNamesByIds, describeWorkspaces } from '../../tenancy/index.ts';

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
