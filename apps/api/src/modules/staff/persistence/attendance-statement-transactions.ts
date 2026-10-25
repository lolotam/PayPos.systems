import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  AttendanceStatementTransactions,
  StatementRequestContext,
  StatementRequestRow,
  StatementScope,
} from '../ports/attendance-statement.port.ts';
import { readStatementBranch } from './attendance-statement-branch.ts';
import { readAttendanceStatementEmployeeInputs } from './attendance-statement-employee-inputs.ts';
import { createStatementLogoReferenceReader } from './statement-logo-reference.adapter.ts';

export function createAttendanceStatementTransactions(
  database: TenantWrappers,
): AttendanceStatementTransactions {
  return {
    run: (scope, work) =>
      database.withTenant(scope.companyId, async (tx) => work(await requestContext(tx, scope)), {
        userId: scope.userId,
      }),
  };
}

async function requestContext(
  tx: Tx,
  scope: Omit<StatementScope, 'userId'>,
): Promise<StatementRequestContext> {
  let cached: { id: string; timezone: string } | null | undefined;
  const branch = async () => {
    if (cached === undefined) {
      cached = await readStatementBranch(tx, scope.companyId, scope.businessId, scope.branchId);
    }
    return cached;
  };
  return {
    branch,
    employeeInputs: async (employeeId, period) => {
      const current = await branch();
      if (current === null) return null;
      return readAttendanceStatementEmployeeInputs(
        tx,
        scope.companyId,
        scope.businessId,
        current,
        employeeId,
        period,
      );
    },
    logo: createStatementLogoReferenceReader(tx, scope.companyId),
    insert: (row) => insertRequest(tx, row),
  };
}

async function insertRequest(tx: Tx, row: StatementRequestRow): Promise<void> {
  await tx.execute(sql`
    INSERT INTO attendance_statement_requests (
      company_id, id, business_id, branch_id, form, employee_id,
      period_from, period_to, language, shift_start, shift_end,
      logo_file_id, requested_by, requested_at
    ) VALUES (
      ${row.companyId}::uuid, ${row.id}::uuid, ${row.businessId}::uuid,
      ${row.branchId}::uuid, ${row.form}, ${row.employeeId}::uuid,
      ${row.from}::date, ${row.to}::date, ${row.language},
      ${row.shift?.start ?? null}::time, ${row.shift?.end ?? null}::time,
      ${row.logoFileId}::uuid, ${row.requestedBy}::uuid,
      ${row.requestedAt.toISOString()}::timestamptz
    )`);
}
