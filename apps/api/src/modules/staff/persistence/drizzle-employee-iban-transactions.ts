import { appendAuditLog, type TenantWrappers, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  EmployeeIbanError,
  ibanAuditSnapshot,
  type EmployeeIbanEntry,
} from '../domain/employee-iban.ts';
import type {
  EmployeeIbanContext,
  EmployeeIbanTransactions,
} from '../ports/employee-iban-transactions.port.ts';
import { createEmployeeIbanAccess } from './employee-iban-access.adapter.ts';

async function authorize(tx: Tx, context: EmployeeIbanContext) {
  const { companyId, userId, businessId, employeeId } = context;
  const access = createEmployeeIbanAccess();
  await access.lock(tx, companyId);
  const [employee] = await tx.execute<{ primary_branch_id: string }>(sql`
    SELECT primary_branch_id FROM employees WHERE company_id=${companyId}
    AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (!employee) throw new EmployeeIbanError('NOT_FOUND');
  const branches = await tx.execute<{
    branch_id: string;
  }>(sql`SELECT branch_id FROM employee_branches
    WHERE company_id=${companyId} AND employee_id=${employeeId} AND "to" IS NULL`);
  const decision = await access.check(tx, companyId, userId, businessId, [
    employee.primary_branch_id,
    ...branches.map((b) => b.branch_id),
  ]);
  if (!decision.manage) throw new EmployeeIbanError('NOT_FOUND');
  if (!decision.featureEnabled) throw new EmployeeIbanError('FEATURE_DISABLED');
}

async function loadCurrent(
  tx: Tx,
  context: EmployeeIbanContext,
): Promise<EmployeeIbanEntry | null> {
  const [row] = await tx.execute<EmployeeIbanEntry & Record<string, unknown>>(sql`
    SELECT id, employee_id, revision, iban, bank_id, holder_name_en, set_by, reason,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at
    FROM employee_ibans WHERE company_id=${context.companyId} AND employee_id=${context.employeeId}
    ORDER BY revision DESC LIMIT 1`);
  return row ?? null;
}

export function duplicateEmployeeIbanStatement(context: EmployeeIbanContext, iban: string) {
  return sql`SELECT 1 FROM employee_ibans i JOIN employees e
    ON e.company_id=i.company_id AND e.business_id=i.business_id AND e.id=i.employee_id
    WHERE i.company_id=${context.companyId} AND i.iban=${iban}
      AND i.employee_id<>${context.employeeId} AND e.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM employee_ibans newer WHERE newer.company_id=i.company_id
        AND newer.employee_id=i.employee_id AND newer.revision>i.revision)
    LIMIT 1`;
}

async function save(
  tx: Tx,
  context: EmployeeIbanContext,
  ids: IdGenerator,
  before: EmployeeIbanEntry | null,
  after: EmployeeIbanEntry,
): Promise<EmployeeIbanEntry> {
  const [row] = await tx.execute<{ set_at: string }>(sql`
    INSERT INTO employee_ibans(company_id,id,business_id,employee_id,revision,iban,bank_id,holder_name_en,set_by,reason)
    VALUES (${context.companyId},${after.id},${context.businessId},${after.employee_id},${after.revision},
      ${after.iban},${after.bank_id},${after.holder_name_en},${after.set_by},${after.reason})
    RETURNING to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at`);
  if (!row) throw new Error('EMPLOYEE_IBAN_PERSISTENCE_FAILED');
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_iban',
    entityId: after.id,
    action: after.iban === null ? 'iban.cleared' : 'iban.set',
    before: ibanAuditSnapshot(before),
    after: ibanAuditSnapshot(after),
  });
  return { ...after, set_at: row.set_at };
}

function persistenceError(error: unknown): never {
  if (error instanceof EmployeeIbanError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (['40001', '40P01', '55P03'].includes(String(cause.code)))
      throw new EmployeeIbanError('TRANSACTION_RETRY_REQUIRED');
    if (
      cause.code === '23505' &&
      'constraint_name' in cause &&
      cause.constraint_name === 'employee_ibans_employee_revision_key'
    )
      throw new EmployeeIbanError('EMPLOYEE_IBAN_REVISION_CONFLICT');
  }
  throw new Error('EMPLOYEE_IBAN_PERSISTENCE_FAILED');
}

export function createEmployeeIbanTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeIbanTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => {
            await authorize(tx, context);
            return work({
              loadCurrent: () => loadCurrent(tx, context),
              ibanUsedByOtherEmployee: async (iban) =>
                (await tx.execute(duplicateEmployeeIbanStatement(context, iban))).length > 0,
              save: (before, after) => save(tx, context, ids, before, after),
            });
          },
          { userId: context.userId },
        );
      } catch (error) {
        return persistenceError(error);
      }
    },
  };
}
