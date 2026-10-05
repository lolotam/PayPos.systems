import type { Tx } from '@pospay/db';
import {
  lockEmployeeManagementAccess,
  readEmployeeManagementAccess,
} from '../../identity/index.ts';

// إدارة كارت الموظف تحمل نفس إذن إدارة الموظفين؛ الربط في الهوية فقط.
export function createEmployeeCardAccess() {
  return {
    read: (tx: Tx, companyId: string, userId: string, businessId: string) =>
      readEmployeeManagementAccess(tx, companyId, userId, businessId),
    lock: (tx: Tx, companyId: string, userId: string, businessId: string) =>
      lockEmployeeManagementAccess(tx, companyId, userId, businessId),
  };
}
