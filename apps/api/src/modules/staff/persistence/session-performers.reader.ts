import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceWorkingDate } from '../domain/clock-attendance.ts';
import { performerEligible, type PerformerEligibilityFacts } from '../domain/performer-eligibility.ts';
import { schedulingContext } from './schedule-context.adapter.ts';

export async function readSessionPerformers(tx: Tx, companyId: string, businessId: string, branchId: string,
  employeeIds: readonly string[], occurredAt: Date, lockOnly = false) {
  if (employeeIds.length === 0 || employeeIds.length > 80) throw new RangeError('Session performer batch size');
  const ids = [...new Set(employeeIds)].sort();
  const selected = sql`id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])`;
  if (lockOnly) {
    await tx.execute(sql`SELECT id FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND ${selected} ORDER BY id FOR SHARE`);
    return [];
  }
  const place = await schedulingContext(tx, companyId, businessId, branchId);
  if (place === null || !('timezone' in place)) return [];
  const day = attendanceWorkingDate(occurredAt, place.timezone);
  const rows = await tx.execute<PerformerEligibilityFacts & { id: string; name_en: string; name_ar: string | null; user_id: string | null; clocked_in: boolean; approved_leave: boolean }>(sql`
    SELECT e.id,e.name_en,e.name_ar,e.user_id,e.hire_date::text,e.contract_end::text,e.deleted_at::text,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',eb.branch_id,'from',eb."from",'to',eb."to"))
        FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.business_id=e.business_id
          AND eb.employee_id=e.id AND eb.branch_id=${branchId}),'[]'::jsonb) AS attachments,
      EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.company_id=e.company_id AND a.employee_id=e.id
        AND a.branch_id=${branchId} AND a.working_date=${day}::date AND a.voided_at IS NULL
        AND a.status IN ('OPEN','CLOSED','MISSED_OUT')) AS clocked_in,
      EXISTS(SELECT 1 FROM leave_requests l WHERE l.company_id=e.company_id AND l.employee_id=e.id AND l.status='APPROVED'
        AND ((l.kind='FULL_DAY' AND l."from"<=${day}::date AND l."to">=${day}::date)
          OR (l.kind='PARTIAL' AND l.starts_at<=${occurredAt.toISOString()}::timestamptz AND l.ends_at>${occurredAt.toISOString()}::timestamptz))) AS approved_leave
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.${selected} ORDER BY e.id`);
  return Array.from(rows, (row) => ({
    id: row.id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    user_id: row.user_id,
    eligible: performerEligible(row, branchId, day),
    clocked_in: row.clocked_in,
    approved_leave: row.approved_leave,
  }));
}
