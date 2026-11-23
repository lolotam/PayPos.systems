import type { Tx } from '@pospay/db';
import { readRatingsReadAccess } from '../../identity/index.ts';
import { readEmployeeDisplayNames } from '../../staff/index.ts';
import { businessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';

/** قراءات قائمة التقييمات ومتوسطاتها من identity وtenancy وstaff؛ الشكل معرّف في queries/ratings-list-reads.ts وبيتربط في الوحدة. */
export const ratingsListReads = {
  access: (...args: Parameters<typeof readRatingsReadAccess>) => readRatingsReadAccess(...args),
  branchNames: async (tx: Tx, businessId: string) => {
    const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
    const branches = tree?.businesses.find((b) => b.id === businessId)?.branches ?? [];
    return new Map(branches.map((b) => [b.id, { name_ar: b.name_ar, name_en: b.name_en }]));
  },
  timeZone: (tx: Tx, scope: { companyId: string; businessId: string }) =>
    businessTimeZone(tx, scope.companyId, scope.businessId),
  employeeNames: (tx: Tx, companyId: string, employeeIds: readonly string[]) =>
    readEmployeeDisplayNames(tx, companyId, employeeIds),
};
