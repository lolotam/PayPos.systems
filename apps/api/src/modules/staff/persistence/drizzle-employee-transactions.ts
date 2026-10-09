import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { EmployeeCreationError, type EmployeeRecord } from '../domain/create-employee.ts';
import type { EmployeeTransactions } from '../ports/employee-transactions.port.ts';
import {
  authorizeEmployeeCreation,
  canLinkEmployeeUser,
  employeeContext,
  employeeBranchAccess,
} from './employee-context.adapter.ts';

async function insertEmployee(tx: Tx, companyId: string, r: EmployeeRecord, attachmentId: string) {
  await tx.execute(sql`INSERT INTO employees (company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,name_ar_key,name_en_key,role_code,hire_date,contract_end,created_at)
    VALUES (${companyId},${r.id},${r.business_id},${r.primary_branch_id},${r.user_id},${r.name_ar},${r.name_en},${r.name_ar_key ?? null},${r.name_en_key ?? null},${r.role_code},${r.hire_date},${r.contract_end},${r.created_at})`);
  await tx.execute(sql`INSERT INTO employee_branches (company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${companyId},${attachmentId},${r.business_id},${r.id},${r.primary_branch_id},${r.hire_date})`);
}

function cleanEmployeeError(error: unknown): never {
  if (error instanceof EmployeeCreationError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23505' &&
    'constraint_name' in cause &&
    cause.constraint_name === 'employees_active_user_business_key'
  ) {
    throw new EmployeeCreationError('EMPLOYEE_USER_ALREADY_LINKED');
  }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'constraint_name' in cause &&
    cause.constraint_name === 'employees_user_id_user_id_fk'
  ) {
    throw new EmployeeCreationError('EMPLOYEE_USER_LINK_UNAVAILABLE');
  }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === '40P01' || cause.code === '40001')
  ) {
    throw new EmployeeCreationError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('EMPLOYEE_PERSISTENCE_FAILED');
}
export function createEmployeeTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              authorize: async (businessId, branchId) => {
                if (!(await authorizeEmployeeCreation(tx, companyId, userId, businessId, branchId)))
                  return false;
                const decision = await employeeBranchAccess(tx, companyId, userId, businessId, [
                  branchId,
                ]);
                if (!decision.allowedBranchIds.includes(branchId)) return false;
                if (!decision.featureEnabled) throw new EmployeeCreationError('FEATURE_DISABLED');
                return true;
              },
              context: (record) => employeeContext(tx, companyId, record),
              canLinkUser: (linkedUserId) => canLinkEmployeeUser(tx, companyId, linkedUserId),
              insert: (record, attachmentId) => insertEmployee(tx, companyId, record, attachmentId),
              audit: (record) =>
                appendAuditLog(tx, ids.newId(), {
                  entity: 'employee',
                  entityId: record.id,
                  action: 'created',
                  after: record,
                }),
            }),
          { userId },
        );
      } catch (error) {
        cleanEmployeeError(error);
      }
    },
  };
}
