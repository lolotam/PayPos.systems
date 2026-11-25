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
      e.branch_ids, e.employee_ids, s.status AS statement_status, s.paid_method
    FROM commission_statement_exports e
    JOIN commission_statements s ON s.company_id = e.company_id AND s.business_id = e.business_id
      AND s.period = e.period AND s.id = e.statement_id AND s.company_id = app_company_id()
    WHERE e.company_id = ${companyId} AND e.company_id = app_company_id()
      AND e.render_id = ${renderId}::uuid`;
}

/**
 * صفوف الكشف المجمّد لملف التصدير؛ الفلتر على لقطة الفروع والموظفين المحفوظة،
 * فلا يخرج مبلغ أو اسم عميل من جزء غير مسموح حتى لو الموظفة داخلة في employee_ids.
 * العلامة الجزئية بتتحسب مرة واحدة لكل موظفة في CTE، واسم مكان التنفيذ متجمّد
 * في الصف منذ الاعتماد، فتغيير اسم الفرع لاحقاً ما يغيّرش التصدير (CS-Q35).
 */
export function commissionStatementFrozenRowsStatement(filter: CommissionStatementRowsFilter) {
  const branchIds = uuidArray(filter.branchIds ?? []);
  const employeeIds = uuidArray(filter.employeeIds ?? []);
  return sql`WITH employee_partials AS MATERIALIZED (
      SELECT lines.employee_id, bool_or(NOT (lines.attached_branch_ids && ${branchIds})) AS partial
      FROM commission_statement_lines lines
      WHERE lines.company_id = ${filter.companyId} AND lines.company_id = app_company_id()
        AND lines.business_id = ${filter.businessId}::uuid
        AND lines.statement_id = ${filter.statementId}::uuid
        AND lines.kind <> 'EMPLOYEE'
        AND ${filter.scope} = 'BRANCHES'
      GROUP BY lines.employee_id
    )
    SELECT lines.employee_id, lines.employee_number, lines.employee_name_ar, lines.employee_name_en,
      lines.source_ref, lines.kind, lines.amount::text AS amount, lines.previous_amount::text AS previous_amount,
      lines.new_amount::text AS new_amount, lines.source_period::text AS source_period, lines.source_branch_id,
      lines.source_branch_name_ar, lines.source_branch_name_en,
      lines.attached_branch_ids, COALESCE(lines.business_date, lines.source_business_date)::text AS business_date,
      lines.service_name_ar, lines.service_name_en, lines.customer_name,
      CASE WHEN ${filter.scope} = 'BUSINESS' THEN false
        ELSE COALESCE(employee_partials.partial, false) END AS partial
    FROM commission_statement_lines lines
    LEFT JOIN employee_partials ON employee_partials.employee_id = lines.employee_id
    WHERE lines.company_id = ${filter.companyId} AND lines.company_id = app_company_id()
      AND lines.business_id = ${filter.businessId}::uuid AND lines.statement_id = ${filter.statementId}::uuid
      AND (${filter.scope} = 'BUSINESS'
        OR (lines.employee_id = ANY(${employeeIds}) AND lines.attached_branch_ids && ${branchIds}))
    ORDER BY lines.employee_number, lines.employee_id, lines.source_ref, lines.id`;
}

/** مفتاح قراءة صفوف الصرف لكشف واحد. */
export interface CommissionStatementPaymentsFilter {
  readonly companyId: string;
  readonly businessId: string;
  readonly statementId: string;
}

/**
 * صفوف الصرف المخزّنة لكشف مدفوع، وبتغذّي عمود الكاش المدفوع في ملف التصدير؛
 * بتمشي على commission_statement_payments_statement_idx وبـ app_company_id() صريح. من غير ORDER BY عمدًا: الترتيب بيخلّي المخطّط يفضّل فهرس الموظفة
 * ويفلتر الكشف بعده، والقارئ ما بيعتمدش على الترتيب.
 */
export function commissionStatementPaymentsStatement(filter: CommissionStatementPaymentsFilter) {
  return sql`SELECT p.employee_id, p.paid_amount::text AS paid_amount
    FROM commission_statement_payments p
    WHERE p.company_id = ${filter.companyId} AND p.company_id = app_company_id()
      AND p.business_id = ${filter.businessId}::uuid
      AND p.statement_id = ${filter.statementId}::uuid`;
}
