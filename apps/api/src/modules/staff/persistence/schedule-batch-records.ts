import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  ScheduleError,
  type ScheduleRecord,
  type SchedulingEmployee,
} from '../domain/schedule-types.ts';
import type { ScheduleTarget } from '../ports/schedules.port.ts';

function typedList(values: readonly string[], type: 'uuid' | 'date') {
  return sql.join(
    values.map((value) => sql`${value}::${sql.raw(type)}`),
    sql`,`,
  );
}

// الموظفون يقفلون مرة وبترتيب ثابت؛ بقية القراءات مجمعة لكل الأسابيع المختارة.
export async function scheduleBatchTargets(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  employeeIds: readonly string[],
  weeks: readonly string[],
): Promise<ScheduleTarget[]> {
  const employeesIn = typedList(employeeIds, 'uuid');
  const weeksIn = typedList(weeks, 'date');
  const employees = await tx.execute<{ record: SchedulingEmployee }>(sql`SELECT jsonb_build_object(
    'id',e.id,'business_id',e.business_id,'hire_date',e.hire_date,'contract_end',e.contract_end,'deleted_at',e.deleted_at,
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',eb.branch_id,'from',eb."from",'to',eb."to")) FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id),'[]'::jsonb)) AS record
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.id IN (${employeesIn}) AND e.deleted_at IS NULL ORDER BY e.id FOR UPDATE`);
  if (employees.length !== employeeIds.length) throw new ScheduleError('NOT_FOUND');
  const records = await tx.execute<{ record: ScheduleRecord }>(sql`SELECT jsonb_build_object(
    'id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,'employee_id',s.employee_id,
    'week_start',s.week_start,'timezone',s.timezone,'revision',s.revision,
    'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('day',ss.day,'start',ss.start,'end',ss."end",'working_date',ss.working_date,
      'starts_at',to_char(ss.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(ss.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_start',ss.break_start,'break_end',ss.break_end,
      'break_starts_at',to_char(ss.break_starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_ends_at',to_char(ss.break_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY ss.starts_at)
      FROM staff_schedule_shifts ss WHERE ss.company_id=s.company_id AND ss.schedule_id=s.id),'[]'::jsonb)) AS record
    FROM staff_schedules s WHERE s.company_id=${companyId} AND s.business_id=${businessId} AND s.branch_id=${branchId}
      AND s.employee_id IN (${employeesIn}) AND s.week_start IN (${weeksIn})`);
  // يومان حول الحدود يغطيان اختلاف مناطق الفروع والوردية الليلية؛ لا نحمل تاريخ الموظف كله.
  const windows = sql.join(
    weeks.map(
      (week) =>
        sql`(ss.starts_at < ${week}::date + interval '9 days' AND ss.ends_at > ${week}::date - interval '2 days')`,
    ),
    sql` OR `,
  );
  const others = await tx.execute<{
    employee_id: string;
    record: ScheduleTarget['others'][number];
  }>(sql`SELECT ss.employee_id,jsonb_build_object(
    'branch_id',s.branch_id,'week_start',s.week_start,'day',ss.day,'start',ss.start,'end',ss."end",'working_date',ss.working_date,
    'starts_at',to_char(ss.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ends_at',to_char(ss.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_start',ss.break_start,'break_end',ss.break_end,
      'break_starts_at',to_char(ss.break_starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'break_ends_at',to_char(ss.break_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS record
    FROM staff_schedule_shifts ss JOIN staff_schedules s ON s.company_id=ss.company_id AND s.id=ss.schedule_id
    WHERE ss.company_id=${companyId} AND ss.employee_id IN (${employeesIn}) AND (${windows})
      AND NOT(s.branch_id=${branchId} AND s.week_start IN (${weeksIn}))`);
  return employees.flatMap(({ record: employee }) =>
    [...weeks].sort().map((weekStart) => ({
      employee,
      weekStart,
      before:
        records.find(
          ({ record }) => record.employee_id === employee.id && record.week_start === weekStart,
        )?.record ?? null,
      others: others.filter((row) => row.employee_id === employee.id).map((row) => row.record),
    })),
  );
}
