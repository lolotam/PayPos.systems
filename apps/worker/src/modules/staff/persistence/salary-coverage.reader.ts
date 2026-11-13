import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from '@pospay/db';

export function salaryCoverageStatement(
  companyId: string,
  after: { readonly employeeId: string; readonly effectiveFrom: string } | null,
  limit: number,
): SQL {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('COVERAGE_PAGE_LIMIT_INVALID');
  }
  const page =
    after === null
      ? sql``
      : sql`AND (employee_id, effective_from) > (${after.employeeId}::uuid, ${after.effectiveFrom}::date)`;
  return sql`
    SELECT employee_id, effective_from::text AS effective_from, revision::int AS revision
      FROM employee_salaries
     WHERE company_id = ${companyId}
       ${page}
     ORDER BY employee_id, effective_from
     LIMIT ${limit}`;
}

export async function readSalaryCoveragePage(
  tx: Tx,
  companyId: string,
  after: { readonly employeeId: string; readonly effectiveFrom: string } | null,
  limit: number,
): Promise<{
  rows: { employeeId: string; effectiveFrom: string; revision: number }[];
  next: { employeeId: string; effectiveFrom: string } | null;
}> {
  const result = await tx.execute<{
    employee_id: string;
    effective_from: string;
    revision: number;
  }>(salaryCoverageStatement(companyId, after, limit));
  const rows = result.map((row) => ({
    employeeId: row.employee_id,
    effectiveFrom: row.effective_from,
    revision: row.revision,
  }));
  const last = result[result.length - 1];
  return {
    rows,
    next:
      result.length === limit && last !== undefined
        ? { employeeId: last.employee_id, effectiveFrom: last.effective_from }
        : null,
  };
}
