import type { Tx } from '@pospay/db';
import { lockEmployeeManagementAccess, readEmployeeBranchAccess } from '../../identity/index.ts';
import type { EmployeeCardAccess } from './employee-card-access.ts';

// سماح النشاط لا يلغي منع فرع الموظف؛ السلطة تُحسب على الفروع المحفوظة نفسها.
async function atBranches(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
): Promise<{ manage: boolean; featureEnabled: boolean }> {
  const decision = await readEmployeeBranchAccess(tx, companyId, userId, businessId, branchIds);
  const manage =
    branchIds.length > 0 &&
    branchIds.every((branchId) => decision.allowedBranchIds.includes(branchId));
  return { manage, featureEnabled: manage && decision.featureEnabled };
}

export function createEmployeeCardAccess(): EmployeeCardAccess {
  return {
    read: (tx, companyId, userId, businessId, branchIds) =>
      atBranches(tx, companyId, userId, businessId, branchIds),
    lock: async (tx, companyId, userId, businessId) => {
      await lockEmployeeManagementAccess(tx, companyId, userId, businessId);
    },
  };
}
