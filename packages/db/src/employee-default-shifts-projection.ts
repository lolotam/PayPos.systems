import { sql } from 'drizzle-orm';
import { currentAttachment } from './employee-branch-links.ts';

// قسم الدوام في ملف الموظفة ورد الحفظ يقرآن الإسقاط نفسه كي يظل الرد مطابقاً للدوام المحفوظ.
// رد الحفظ يمرر لحظة الساعة المحقونة اللي اتفحص بيها الارتباط، كي لا يختلف اليوم عند منتصف الليل.
export function employeeDefaultShiftsStatement(
  context: { companyId: string; employeeId: string },
  branches: readonly { id: string; timezone: string }[],
  at?: Date,
) {
  const { companyId, employeeId } = context;
  const now = at === undefined ? sql`CURRENT_TIMESTAMP` : sql`${at.toISOString()}::timestamptz`;
  const today = sql`(${now} AT TIME ZONE br.timezone)::date`;
  const payload = JSON.stringify(branches);
  return sql`SELECT br.id AS branch_id,
    EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId}
      AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
      AND eb."from" <= ${today}
      AND ${currentAttachment(today)}) AS linked,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5),'break_start',left(d.break_start::text,5),
      'break_end',left(d.break_end::text,5)) ORDER BY d.day)
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id),'[]'::jsonb) AS shifts,
    (SELECT to_char(max(d.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id) AS updated_at
    FROM jsonb_to_recordset(${payload}::jsonb) AS br(id uuid, timezone text)
    WHERE (EXISTS(SELECT 1 FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id)
        OR EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId} AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
          AND eb."from" <= ${today}
          AND ${currentAttachment(today)}))
    ORDER BY br.id`;
}
