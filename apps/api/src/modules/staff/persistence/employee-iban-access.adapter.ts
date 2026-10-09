import type { Tx } from '@pospay/db';
import {
  lockEmployeeSalaryAccess,
  readEmployeeSalaryAccess,
  readEmployeeManagementAccess,
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
    const employee = await readEmployeeManagementAccess(tx, companyId, userId, businessId);
    return {
      read: false,
      manage: false,
      masked: employee.manage,
      featureEnabled: employee.featureEnabled,
    };
  },
});
