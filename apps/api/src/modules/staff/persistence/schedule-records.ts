import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  ScheduleError,
  type ConcreteShift,
  type ScheduleRecord,
  type SchedulingEmployee,
  type TemplateRecord,
} from '../domain/schedule-types.ts';

export async function lockedSchedulingEmployee(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<SchedulingEmployee> {
  const [row] = await tx.execute<{ record: SchedulingEmployee }>(sql`SELECT jsonb_build_object(
    'id',id,'business_id',business_id,'hire_date',hire_date,'contract_end',contract_end,'deleted_at',deleted_at,
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',branch_id,'from',"from",'to',"to")) FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id),'[]'::jsonb)) AS record
    FROM employees e WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (!row) throw new ScheduleError('NOT_FOUND');
  return row.record;
}
export async function scheduleRecord(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  employeeId: string,
  week: string,
): Promise<ScheduleRecord | null> {
  const [row] = await tx.execute<{ record: ScheduleRecord }>(sql`SELECT jsonb_build_object(
    'id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,'employee_id',s.employee_id,
    'week_start',s.week_start,'timezone',s.timezone,'revision',s.revision,
    'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('day',day,'start',start,'end',"end",'working_date',working_date,
      'starts_at',to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_start',break_start,'break_end',break_end,
      'break_starts_at',to_char(break_starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_ends_at',to_char(break_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY starts_at)
      FROM staff_schedule_shifts ss WHERE ss.company_id=s.company_id AND ss.schedule_id=s.id),'[]'::jsonb)) AS record
    FROM staff_schedules s WHERE company_id=${companyId} AND business_id=${businessId} AND branch_id=${branchId} AND employee_id=${employeeId} AND week_start=${week}`);
  return row?.record ?? null;
}
export async function otherEmployeeShifts(
  tx: Tx,
  companyId: string,
  employeeId: string,
  before: ScheduleRecord | null,
): Promise<(ConcreteShift & { branch_id: string; week_start: string })[]> {
  const rows = await tx.execute<{
    record: ConcreteShift & { branch_id: string; week_start: string };
  }>(sql`SELECT jsonb_build_object(
    'branch_id',s.branch_id,'week_start',s.week_start,'day',ss.day,'start',ss.start,'end',ss."end",'working_date',ss.working_date,
    'starts_at',to_char(ss.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ends_at',to_char(ss.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_start',ss.break_start,'break_end',ss.break_end,
      'break_starts_at',to_char(ss.break_starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_ends_at',to_char(ss.break_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS record
    FROM staff_schedule_shifts ss JOIN staff_schedules s ON s.company_id=ss.company_id AND s.id=ss.schedule_id
    WHERE ss.company_id=${companyId} AND ss.employee_id=${employeeId} AND (${before?.id ?? null}::uuid IS NULL OR ss.schedule_id <> ${before?.id ?? null}::uuid)`);
  return rows.map((row) => row.record);
}
export async function lockedTemplate(
  tx: Tx,
  companyId: string,
  businessId: string,
  templateId: string,
): Promise<TemplateRecord> {
  const [row] = await tx.execute<{
    record: TemplateRecord;
  }>(sql`SELECT jsonb_build_object('id',id,'business_id',business_id,'name_en',name_en,'name_ar',name_ar,
    'shifts',shifts,'revision',revision,'archived_at',CASE WHEN archived_at IS NULL THEN NULL ELSE to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) AS record
    FROM staff_shift_templates WHERE company_id=${companyId} AND business_id=${businessId} AND id=${templateId} FOR UPDATE`);
  if (!row) throw new ScheduleError('NOT_FOUND');
  return {
    ...row.record,
    shifts: row.record.shifts.map((shift) => ({
      ...shift,
      break_start: shift.break_start ?? null,
      break_end: shift.break_end ?? null,
    })),
  };
}
