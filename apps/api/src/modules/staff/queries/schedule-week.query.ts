import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ScheduleGrid, ScheduleListQuery, StaffSchedule } from '@pospay/contracts';

export const SCHEDULE_READ_ACCESS = Symbol('SCHEDULE_READ_ACCESS');
export type ScheduleReadFailure =
  'NOT_FOUND' | 'FORBIDDEN' | 'FEATURE_DISABLED' | 'SCHEDULE_WEEK_INVALID';
export interface ScheduleReadAccess {
  read(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string | null,
    week?: string,
  ): Promise<{ timezone: string } | ScheduleReadFailure>;
}
// ورديات شبكة الفرع تخرج كـ DTO واحد دون قراءة راتب أو ورديات فرع آخر.
export const scheduleProjection = sql`jsonb_build_object('id',s.id,'business_id',s.business_id,'branch_id',s.branch_id,'employee_id',s.employee_id,
  'week_start',s.week_start,'timezone',s.timezone,'revision',s.revision,
  'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('day',ss.day,'start',ss.start,'end',ss."end",'working_date',ss.working_date,
    'starts_at',to_char(ss.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ends_at',to_char(ss.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY ss.starts_at)
    FROM staff_schedule_shifts ss WHERE ss.company_id=s.company_id AND ss.schedule_id=s.id),'[]'::jsonb))`;

// شبكة الفرع تعرض موظفي الأسبوع حتى بدون جدول؛ الفلترة وتحديد الصفحة يأتيان قبل بناء الصفوف.
export function branchScheduleStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  query: ScheduleListQuery,
) {
  return sql`WITH rows AS (SELECT e.id, jsonb_build_object('employee_id',e.id,'name_en',e.name_en,'name_ar',e.name_ar,
    'schedule',(SELECT ${scheduleProjection} FROM staff_schedules s
      WHERE s.company_id=e.company_id AND s.business_id=${businessId} AND s.branch_id=${branchId} AND s.employee_id=e.id AND s.week_start=${query.week_start})) AS row
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.deleted_at IS NULL
      AND (${query.cursor ?? null}::uuid IS NULL OR e.id > ${query.cursor ?? null}::uuid)
      AND e.hire_date <= ${query.week_start}::date + 6 AND (e.contract_end IS NULL OR e.contract_end >= ${query.week_start}::date)
      AND EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb.branch_id=${branchId}
        AND eb."from" <= LEAST(${query.week_start}::date + 6,COALESCE(e.contract_end,${query.week_start}::date + 6))
        AND (eb."to" IS NULL OR eb."to" > GREATEST(${query.week_start}::date,e.hire_date)))
    ORDER BY e.id LIMIT ${query.limit + 1}) SELECT
    (SELECT array_agg(to_char(${query.week_start}::date + n,'YYYY-MM-DD') ORDER BY n) FROM generate_series(0,6) AS n) AS days,
    COALESCE((SELECT max_shifts_per_day FROM staff_schedule_settings WHERE company_id=${companyId} AND business_id=${businessId}),3) AS max_shifts_per_day,
    COALESCE(jsonb_agg(rows.row ORDER BY rows.id),'[]'::jsonb) AS items FROM rows`;
}
export async function branchScheduleWeek(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  query: ScheduleListQuery,
  access: ScheduleReadAccess,
): Promise<ScheduleGrid | ScheduleReadFailure> {
  const context = await access.read(tx, companyId, userId, businessId, branchId, query.week_start);
  if (typeof context === 'string') return context;
  const [page] = await tx.execute<{ days: string[]; items: ScheduleGrid['items']; max_shifts_per_day: number }>(
    branchScheduleStatement(companyId, businessId, branchId, query),
  );
  if (!page) throw new Error('SCHEDULE_QUERY_FAILED');
  const rows = page.items;
  return {
    week_start: query.week_start,
    days: page.days,
    timezone: context.timezone,
    max_shifts_per_day: page.max_shifts_per_day,
    items: rows.slice(0, query.limit),
    next_cursor: rows.length > query.limit ? (rows[query.limit - 1]?.employee_id ?? null) : null,
  };
}
// تفاصيل موظف واحد تعرض أسبوع الفرع المطلوب فقط ولا تكشف وردياته في الفروع الأخرى.
export function employeeScheduleStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  employeeId: string,
  week: string,
) {
  return sql`SELECT (SELECT ${scheduleProjection} FROM staff_schedules s
    WHERE s.company_id=e.company_id AND s.business_id=e.business_id AND s.branch_id=${branchId} AND s.employee_id=e.id AND s.week_start=${week}) AS record
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId} AND e.id=${employeeId} AND e.deleted_at IS NULL
    AND e.hire_date <= ${week}::date+6 AND (e.contract_end IS NULL OR e.contract_end >= ${week}::date)
    AND EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb.branch_id=${branchId}
      AND eb."from" <= LEAST(${week}::date+6,COALESCE(e.contract_end,${week}::date+6))
      AND (eb."to" IS NULL OR eb."to" > GREATEST(${week}::date,e.hire_date)))`;
}
export async function employeeScheduleWeek(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  employeeId: string,
  week: string,
  access: ScheduleReadAccess,
): Promise<{ schedule: StaffSchedule | null } | ScheduleReadFailure> {
  const context = await access.read(tx, companyId, userId, businessId, branchId, week);
  if (typeof context === 'string') return context;
  const [record] = await tx.execute<{ record: StaffSchedule | null }>(
    employeeScheduleStatement(companyId, businessId, branchId, employeeId, week),
  );
  return record ? { schedule: record.record } : 'NOT_FOUND';
}
