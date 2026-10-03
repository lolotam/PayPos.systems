import type { Tx } from '@pospay/db';
import { lockEmployeeSalaryAccess, readEmployeeSalaryAccess } from '../../identity/index.ts';
export const createSalaryAccess = () => ({
  lock: (tx: Tx, companyId: string) => lockEmployeeSalaryAccess(tx, companyId),
  check: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ) => readEmployeeSalaryAccess(tx, companyId, userId, businessId, branchIds),
});
