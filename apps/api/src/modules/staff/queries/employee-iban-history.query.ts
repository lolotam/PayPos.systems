import { employeeIbanHistoryPage, type EmployeeIbanHistoryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  employeeIbanDecision,
  type EmployeeIbanReadAccess,
  type EmployeeIbanReadContext,
} from './employee-iban.query.ts';

export function employeeIbanHistoryStatement(
  context: EmployeeIbanReadContext,
  query: EmployeeIbanHistoryQuery,
) {
  // جدول تاريخ الحساب في شاشة الموظف يعرض نسخاً ثابتة بترتيب تنازلي ومؤشر لا يتأثر بإضافة نسخة.
  return sql`SELECT revision, iban, bank_id, holder_name_en, iban IS NULL AS cleared, set_by, reason,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS set_at
    FROM employee_ibans WHERE company_id=${context.companyId} AND employee_id=${context.employeeId}
    ${query.cursor === undefined ? sql`` : sql`AND revision < ${query.cursor}`}
    ORDER BY revision DESC LIMIT ${query.limit + 1}`;
}

export async function employeeIbanHistory(
  tx: Tx,
  context: EmployeeIbanReadContext,
  query: EmployeeIbanHistoryQuery,
  access: EmployeeIbanReadAccess,
) {
  const decision = await employeeIbanDecision(tx, context, access);
  if (!decision?.read) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  const rows = await tx.execute(employeeIbanHistoryStatement(context, query));
  const items = rows.slice(0, query.limit);
  return employeeIbanHistoryPage.parse({
    items,
    next_cursor: rows.length > query.limit ? items.at(-1)?.['revision'] : null,
  });
}
