import type { ScheduleShift } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface EmployeeContractedMinutesRow extends Record<string, unknown> {
  employee_id: string;
  hire_date: string;
  contract_end: string | null;
  links: { from: string; to: string | null }[];
  entries: ScheduleShift[];
}

// يستهلك تقرير الشهر في الصف 27 هذا الإسقاط؛ الحساب والفلترة اليومية في الدالة المشتركة عند المستهلك.
export function employeeContractedMinutesStatement(companyId: string, businessId: string,
  branchId: string, from: string, to: string) {
  return sql`WITH defaults AS MATERIALIZED (SELECT d.employee_id,
    jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5),'break_start',left(d.break_start::text,5),
      'break_end',left(d.break_end::text,5)) ORDER BY d.day) AS entries
    FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.business_id=${businessId}
      AND d.branch_id=${branchId} GROUP BY d.employee_id)
    SELECT e.id AS employee_id, to_char(e.hire_date,'YYYY-MM-DD') AS hire_date,
    to_char(e.contract_end,'YYYY-MM-DD') AS contract_end,
    (SELECT jsonb_agg(jsonb_build_object('from',to_char(eb."from",'YYYY-MM-DD'),
      'to',to_char(eb."to",'YYYY-MM-DD')) ORDER BY eb."from") FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb.branch_id=${branchId}
        AND eb."from"<=${to}::date AND (eb."to" IS NULL OR eb."to">${from}::date)) AS links,
    COALESCE(d.entries,'[]'::jsonb) AS entries
    FROM employees e LEFT JOIN defaults d ON d.employee_id=e.id
    WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.deleted_at IS NULL
      AND e.hire_date<=${to}::date AND (e.contract_end IS NULL OR e.contract_end>=${from}::date)
      AND EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id
        AND eb.branch_id=${branchId} AND eb."from"<=LEAST(${to}::date,COALESCE(e.contract_end,${to}::date))
        AND (eb."to" IS NULL OR eb."to">GREATEST(${from}::date,e.hire_date))) ORDER BY e.id`;
}

export function employeeContractedMinutes(tx: Tx, companyId: string, businessId: string,
  branchId: string, from: string, to: string): Promise<EmployeeContractedMinutesRow[]> {
  return tx.execute<EmployeeContractedMinutesRow>(employeeContractedMinutesStatement(companyId, businessId, branchId, from, to));
}
