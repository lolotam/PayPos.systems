import type { Tx } from '@pospay/db';
import {
  lockEmployeeSalaryAccess,
  readEmployeeSalaryAccess,
  readEmployeeBranchAccess,
} from '../../identity/index.ts';

export const createEmployeeIbanAccess = () => ({
  lock: (tx: Tx, companyId: string) => lockEmployeeSalaryAccess(tx, companyId),
  check: async (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ) => {
    const salary = await readEmployeeSalaryAccess(tx, companyId, userId, businessId, branchIds);
    if (salary.read) return { ...salary, masked: false };
    const employee = await readEmployeeBranchAccess(tx, companyId, userId, businessId, branchIds);
    return {
      read: false,
      manage: false,
      masked:
        branchIds.length > 0 &&
        branchIds.every((branchId) => employee.allowedBranchIds.includes(branchId)),
      featureEnabled: employee.featureEnabled,
    };
  },
});
