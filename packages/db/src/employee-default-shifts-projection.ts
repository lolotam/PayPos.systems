import { sql } from 'drizzle-orm';
import { currentAttachment } from './employee-branch-links.ts';

// قسم الدوام في ملف الموظفة ورد الحفظ يقرآن الإسقاط نفسه كي يظل الرد مطابقاً للدوام المحفوظ.
export function employeeDefaultShiftsStatement(
  context: { companyId: string; employeeId: string },
  branches: readonly { id: string; timezone: string }[],
) {
  const { companyId, employeeId } = context;
  const payload = JSON.stringify(branches);
  return sql`SELECT br.id AS branch_id,
    EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId}
      AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
      AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date
      AND ${currentAttachment(sql`(CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date`)}) AS linked,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5),'break_start',left(d.break_start::text,5),
      'break_end',left(d.break_end::text,5)) ORDER BY d.day)
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id),'[]'::jsonb) AS shifts,
    (SELECT to_char(max(d.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id) AS updated_at
    FROM jsonb_to_recordset(${payload}::jsonb) AS br(id uuid, timezone text)
    WHERE (EXISTS(SELECT 1 FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id)
        OR EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId} AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
          AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date
          AND ${currentAttachment(sql`(CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date`)}))
    ORDER BY br.id`;
}
