import { sql } from 'drizzle-orm';

export interface CommissionStatementRowsFilter {
  readonly companyId: string;
  readonly businessId: string;
  readonly statementId: string;
  readonly scope: 'BUSINESS' | 'BRANCHES';
  readonly branchIds: readonly string[] | null;
  readonly employeeIds: readonly string[] | null;
}

function uuidArray(ids: readonly string[]) {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/** طلب التصدير الذي يحدد الكشف والنطاق واللغة؛ RLS والشرط الصريح يمنعان طلب مستأجر آخر. */
export function commissionStatementExportRequestStatement(companyId: string, renderId: string) {
  return sql`SELECT e.statement_id, e.business_id, e.period::text AS period, e.language, e.scope,
      e.branch_ids, e.employee_ids, s.status AS statement_status
    FROM commission_statement_exports e
    JOIN commission_statements s ON s.company_id = e.company_id AND s.business_id = e.business_id
      AND s.period = e.period AND s.id = e.statement_id AND s.company_id = app_company_id()
    WHERE e.company_id = ${companyId} AND e.company_id = app_company_id()
      AND e.render_id = ${renderId}::uuid`;
}

/**
 * صفوف الكشف المجمّد لملف التصدير؛ الفلتر على لقطة الفروع والموظفين المحفوظة،
 * فلا يخرج مبلغ أو اسم عميل من جزء غير مسموح حتى لو الموظفة داخلة في employee_ids.
 */
export function commissionStatementFrozenRowsStatement(filter: CommissionStatementRowsFilter) {
  const branchIds = uuidArray(filter.branchIds ?? []);
  const employeeIds = uuidArray(filter.employeeIds ?? []);
  return sql`SELECT employee_id, employee_number, employee_name_ar, employee_name_en,
      source_ref, kind, amount::text AS amount, previous_amount::text AS previous_amount,
      new_amount::text AS new_amount, source_period::text AS source_period, source_branch_id,
      attached_branch_ids, COALESCE(business_date, source_business_date)::text AS business_date,
      service_name_ar, service_name_en, customer_name,
      CASE WHEN ${filter.scope} = 'BUSINESS' THEN false ELSE COALESCE((
        SELECT bool_or(NOT (outside.attached_branch_ids && ${branchIds}))
        FROM commission_statement_lines outside
        WHERE outside.company_id = commission_statement_lines.company_id
          AND outside.company_id = app_company_id()
          AND outside.business_id = commission_statement_lines.business_id
          AND outside.statement_id = commission_statement_lines.statement_id
          AND outside.employee_id = commission_statement_lines.employee_id
          AND outside.kind <> 'EMPLOYEE'
      ), false) END AS partial
    FROM commission_statement_lines
    WHERE company_id = ${filter.companyId} AND company_id = app_company_id()
      AND business_id = ${filter.businessId}::uuid AND statement_id = ${filter.statementId}::uuid
      AND (${filter.scope} = 'BUSINESS'
        OR (employee_id = ANY(${employeeIds}) AND attached_branch_ids && ${branchIds}))
    ORDER BY employee_number, employee_id, source_ref, id`;
}
