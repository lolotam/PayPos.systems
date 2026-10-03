import {
  appendAuditLog,
  appendOutboxEvent,
  runIdempotent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  type TenantWrappers,
  type IdGenerator,
  type Tx,
} from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { SalaryError, salarySnapshot, type SalaryRecord } from '../domain/set-salary.ts';
import type { SalaryTransactions } from '../ports/salary-transactions.port.ts';
import { createSalaryAccess } from './employee-salary-access.adapter.ts';
async function authorize(
  tx: Tx,
  context: { companyId: string; userId: string; businessId: string; employeeId: string },
) {
  const { companyId, userId, businessId, employeeId } = context;
  const access = createSalaryAccess();
  await access.lock(tx, companyId);
  const [employee] = await tx.execute<{ primary_branch_id: string }>(
    sql`SELECT primary_branch_id FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`,
  );
  if (employee === undefined) throw new SalaryError('NOT_FOUND');
  const branches = await tx.execute<{ branch_id: string }>(
    sql`SELECT branch_id FROM employee_branches WHERE company_id=${companyId} AND employee_id=${employeeId} AND "to" IS NULL`,
  );
  const decision = await access.check(tx, companyId, userId, businessId, [
    employee.primary_branch_id,
    ...branches.map((b) => b.branch_id),
  ]);
  if (!decision.manage) throw new SalaryError('NOT_FOUND');
  if (!decision.featureEnabled) throw new SalaryError('FEATURE_DISABLED');
}
async function load(
  tx: Tx,
  companyId: string,
  employeeId: string,
  date: string,
): Promise<SalaryRecord | null> {
  const [row] = await tx.execute<Omit<SalaryRecord, 'amount'> & { amount: string }>(
    sql`SELECT id,employee_id,to_char(effective_from,'YYYY-MM-DD') AS effective_from,amount::text AS amount,set_by,revision,reason FROM employee_salaries WHERE company_id=${companyId} AND employee_id=${employeeId} AND effective_from=${date}::date`,
  );
  return row === undefined ? null : { ...row, amount: parseMoney(row.amount) };
}
async function save(
  tx: Tx,
  companyId: string,
  businessId: string,
  ids: IdGenerator,
  before: SalaryRecord | null,
  after: SalaryRecord,
) {
  const row = salarySnapshot(after);
  await tx.execute(sql`INSERT INTO employee_salaries(company_id,id,business_id,employee_id,effective_from,amount,set_by,revision,reason)
    VALUES (${companyId},${row.id},${businessId},${row.employee_id},${row.effective_from},${row.amount},${row.set_by},${row.revision},${row.reason})
    ON CONFLICT (company_id,employee_id,effective_from) DO UPDATE SET amount=EXCLUDED.amount,set_by=EXCLUDED.set_by,revision=EXCLUDED.revision,reason=EXCLUDED.reason`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_salary',
    entityId: row.id,
    action: 'salary.set',
    before: before === null ? null : salarySnapshot(before),
    after: row,
  });
  const payload = {
    employee_id: row.employee_id,
    effective_from: row.effective_from,
    amount: row.amount,
    revision: row.revision,
  };
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: row.employee_id,
    eventType: 'SalaryChanged',
    payload,
  });
}
export function createSalaryTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): SalaryTransactions {
  return {
    run: async (context, work) => {
      try {
        return await database.withTenant(
          context.companyId,
          async (tx) => {
            await authorize(tx, context);
            const result = await runIdempotent(
              tx,
              {
                scope: 'COMPANY',
                operation: 'set-salary',
                key: context.key,
                fingerprint: context.fingerprint,
              },
              async () => {
                const record = await work({
                  load: (employeeId, date) => load(tx, context.companyId, employeeId, date),
                  save: (businessId, before, after) =>
                    save(tx, context.companyId, businessId, ids, before, after),
                });
                return { status: 200, body: salarySnapshot(record) };
              },
            );
            const row = result.body as Omit<SalaryRecord, 'amount'> & { amount: string };
            return { ...row, amount: parseMoney(row.amount) };
          },
          { userId: context.userId },
        );
      } catch (error) {
        if (
          error instanceof SalaryError ||
          error instanceof IdempotencyKeyBusyError ||
          error instanceof IdempotencyKeyReusedError
        )
          throw error;
        const cause = error instanceof Error && 'cause' in error ? error.cause : error;
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'code' in cause &&
          ['40001', '40P01', '55P03'].includes(String(cause.code))
        )
          throw new SalaryError('TRANSACTION_RETRY_REQUIRED');
        throw new Error('SALARY_PERSISTENCE_FAILED', { cause: error });
      }
    },
  };
}
