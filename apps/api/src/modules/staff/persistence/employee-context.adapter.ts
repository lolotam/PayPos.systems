import type { Tx } from '@pospay/db';

import { lockEmployeeCreationAccess } from '../../identity/index.ts';
import { employeeWorkplace } from '../../tenancy/index.ts';
import type { EmployeeRecord } from '../domain/create-employee.ts';

export function authorizeEmployeeCreation(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
) {
  return lockEmployeeCreationAccess(tx, companyId, userId, businessId, branchId);
}

export function employeeContext(tx: Tx, companyId: string, record: EmployeeRecord) {
  return employeeWorkplace(tx, companyId, record.business_id, record.primary_branch_id);
}
