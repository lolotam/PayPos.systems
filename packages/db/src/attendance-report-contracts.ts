import { sql, type SQL } from 'drizzle-orm';

// تقرير كل الفروع يحتاج إسقاط 16d مرة واحدة؛ الربط والتجميع لا يحسبان ساعات العمل أو الإجازة.
// حذف الموظفة لاحقاً لا يمحو تعاقد الشهر السابق؛ بداية الشهر محلية لكل فرع.
export function attendanceReportContractsStatement(companyId: string, businessId: string, branchIds: SQL, zones: SQL, from: string, to: string) {
  // AB-Q12: يوم الحذف المحلي محسوب مثل آخر يوم للعقد؛ الإسقاط يمرر الحد نفسه لدالة التعاقد.
  const contractEnd = sql`LEAST(e.contract_end,(e.deleted_at AT TIME ZONE z.timezone)::date)`;
  const deletion = sql`(e.deleted_at IS NULL OR e.deleted_at>=(${from}::date::timestamp AT TIME ZONE z.timezone))`;
  return sql`WITH zones(branch_id,timezone) AS (VALUES ${zones}),
    defaults AS MATERIALIZED (SELECT d.employee_id,d.branch_id,
    jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5)) ORDER BY d.day) AS entries
    FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.business_id=${businessId}
      AND d.branch_id=ANY(${branchIds}) GROUP BY d.employee_id,d.branch_id),
    links AS MATERIALIZED (SELECT e.id AS employee_id,eb.branch_id,
      to_char(e.hire_date,'YYYY-MM-DD') AS hire_date,to_char(${contractEnd},'YYYY-MM-DD') AS contract_end,
      jsonb_agg(jsonb_build_object('from',to_char(eb."from",'YYYY-MM-DD'),
        'to',to_char(eb."to",'YYYY-MM-DD')) ORDER BY eb."from") AS links
      FROM employees e JOIN employee_branches eb ON eb.company_id=e.company_id AND eb.employee_id=e.id
      JOIN zones z ON z.branch_id=eb.branch_id
      WHERE e.company_id=${companyId} AND e.business_id=${businessId}
        AND ${deletion}
        AND e.hire_date<=${to}::date AND (e.contract_end IS NULL OR e.contract_end>=${from}::date)
        AND eb.branch_id=ANY(${branchIds}) AND eb."from"<=${to}::date AND (eb."to" IS NULL OR eb."to">${from}::date)
      GROUP BY e.id,e.hire_date,e.contract_end,e.deleted_at,eb.branch_id,z.timezone
      HAVING bool_or(eb."from"<=LEAST(${to}::date,COALESCE(${contractEnd},${to}::date))
        AND (eb."to" IS NULL OR eb."to">GREATEST(${from}::date,e.hire_date))))
    SELECT l.employee_id,l.branch_id,l.hire_date,l.contract_end,l.links,COALESCE(d.entries,'[]'::jsonb) AS entries
    FROM links l LEFT JOIN defaults d ON d.employee_id=l.employee_id AND d.branch_id=l.branch_id`;
}
