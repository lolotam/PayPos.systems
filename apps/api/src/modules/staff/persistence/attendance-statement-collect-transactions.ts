import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import type {
  StatementCollectContext,
  StatementCollectTransactions,
  StatementRequestRow,
  StatementScope,
} from '../ports/attendance-statement.port.ts';
import { createAttendanceReportAudit } from './attendance-report-audit.adapter.ts';

/** صف الطلب كما يقرؤه التحميل؛ نفس الربط اللي بتستعمله قراءة الحالة. */
interface BindingRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  business_id: string;
  branch_id: string;
  form: string;
  employee_id: string | null;
  period_from: string;
  period_to: string;
  language: string;
  shift_start: string | null;
  shift_end: string | null;
  logo_file_id: string | null;
  requested_by: string;
  requested_at: Date | string;
}

export function createAttendanceStatementCollectTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): StatementCollectTransactions {
  const audit = createAttendanceReportAudit(ids);
  return {
    run: (scope, work) =>
      database.withTenant(scope.companyId, async (tx) => work(collectContext(tx, scope, audit)), {
        userId: scope.userId,
      }),
  };
}

function collectContext(
  tx: Tx,
  scope: StatementScope,
  audit: (tx: Tx) => AuditTrail,
): StatementCollectContext {
  return {
    binding: async (renderId) => bindingRow(tx, scope, renderId),
    audit: audit(tx),
  };
}

async function bindingRow(
  tx: Tx,
  scope: StatementScope,
  renderId: string,
): Promise<StatementRequestRow | null> {
  const rows =
    await tx.execute<BindingRow>(sql`SELECT id, company_id, business_id, branch_id, form, employee_id,
      period_from::text AS period_from, period_to::text AS period_to, language, shift_start, shift_end,
      logo_file_id, requested_by, requested_at
    FROM attendance_statement_requests
    WHERE company_id = ${scope.companyId} AND company_id = app_company_id() AND id = ${renderId}::uuid
      AND business_id = ${scope.businessId} AND branch_id = ${scope.branchId}
      AND requested_by = ${scope.userId}`);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    businessId: row.business_id,
    branchId: row.branch_id,
    form: row.form === 'EMPLOYEE' ? 'EMPLOYEE' : 'BRANCH',
    employeeId: row.employee_id,
    from: row.period_from,
    to: row.period_to,
    language: row.language === 'en' ? 'en' : 'ar',
    shift:
      row.shift_start === null || row.shift_end === null
        ? null
        : { start: row.shift_start.slice(0, 5), end: row.shift_end.slice(0, 5) },
    logoFileId: row.logo_file_id,
    requestedBy: row.requested_by,
    requestedAt: new Date(row.requested_at),
  };
}
