import { appendAuditLog, lockEmployeeNumberCounter, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { SetEmployeeNumberStartError } from '../domain/errors.ts';
import type {
  EmployeeNumberStartActor,
  EmployeeNumberStartAudit,
  EmployeeNumberStartScope,
  EmployeeNumberStartTransactions,
  EmployeeNumberSequenceRow,
} from '../ports/employee-number-start.port.ts';
import { lockEmployeeNumberCompany, recheckEmployeeNumberCompany } from './set-employee-number.adapter.ts';

export function createSetEmployeeNumberStartTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeNumberStartTransactions {
  return {
    run: (actor, work) =>
      database
        .withTenant(actor.companyId, (tx) => work(startScope(tx, actor, ids)), { userId: actor.userId })
        .catch((error: unknown) => {
          throw mappedStart(error);
        }),
  };
}

function startScope(tx: Tx, actor: EmployeeNumberStartActor, ids: IdGenerator): EmployeeNumberStartScope {
  return {
    lockAccess: () => lockEmployeeNumberCompany(tx, actor.companyId),
    recheck: () => recheckEmployeeNumberCompany(tx, actor.companyId, actor.userId),
    lockCounter: () => lockedSequence(tx, actor.companyId),
    save: (at, change) => saveStart(tx, actor.companyId, actor.userId, ids, at, change),
  };
}

async function lockedSequence(tx: Tx, companyId: string): Promise<EmployeeNumberSequenceRow> {
  await lockEmployeeNumberCounter(tx, companyId);
  const [row] = await tx.execute<{ next_number: number | string; start_number: number | string | null }>(sql`
    SELECT next_number, start_number FROM employee_number_sequences WHERE company_id=${companyId}`);
  if (row === undefined) throw new Error('EMPLOYEE_PERSISTENCE_FAILED');
  return {
    nextNumber: Number(row.next_number),
    startNumber: row.start_number === null ? null : Number(row.start_number),
  };
}

async function saveStart(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  at: Date,
  change: EmployeeNumberStartAudit,
) {
  const instant = at.toISOString();
  // الشرط يعيد الرفض قبل التدقيق حتى لا يُكتب صف ثانٍ لو سُبقت البداية تحت نفس القفل.
  const updated = await tx.execute<{ company_id: string }>(sql`
    UPDATE employee_number_sequences
    SET start_number=${change.after.start_number}, start_set_by=${userId},
      start_set_at=${instant}::timestamptz, next_number=${change.after.next_number},
      updated_at=${instant}::timestamptz
    WHERE company_id=${companyId} AND start_number IS NULL
    RETURNING company_id`);
  if (updated.length !== 1) throw new SetEmployeeNumberStartError('EMPLOYEE_NUMBER_START_ALREADY_SET');
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_number_sequences',
    entityId: companyId,
    action: 'employee_number.start_set',
    before: change.before,
    after: change.after,
  });
}

function mappedStart(error: unknown): never {
  const seen = new Set<unknown>();
  let code: string | undefined;
  for (
    let current: unknown = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    if (current instanceof SetEmployeeNumberStartError) throw current;
    const node = current as { code?: unknown };
    if (code === undefined && node.code !== undefined) code = String(node.code);
  }
  if (code === '40001' || code === '40P01' || code === '55P03')
    throw new SetEmployeeNumberStartError('TRANSACTION_RETRY_REQUIRED');
  throw error;
}
