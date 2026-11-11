import { leaveHistoryPage, leaveHistoryQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { leaveContext, leaveFixture, leaveIds, type LeaveFixture } from './leave.fixture.ts';

export { leaveFixture, leaveContext, leaveIds };
export type { LeaveFixture };
export const historyNow = '2026-11-07T10:00:00.000Z';
export const historyQuery = (q: object = {}) =>
  leaveHistoryQuery.parse({ from: '2026-01-01', to: '2026-11-07', ...q });
export async function historyRead(
  f: LeaveFixture,
  q: object = {},
  now = historyNow,
  zone?: 'Etc/GMT+12',
) {
  return f.db.withTenant(f.company, async (tx) => {
    if (zone) await tx.execute(sql`SET LOCAL TIME ZONE 'Etc/GMT+12'`);
    return leaveHistoryPage.parse(
      await getEmployeeLeaveHistory(
        tx,
        leaveContext(f),
        historyQuery(q),
        createLeaveReadAccess({ now: () => new Date(now) }),
      ),
    );
  });
}
export async function historyClear(f: LeaveFixture) {
  await f.h.owner`DELETE FROM attendance_sessions WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM leave_requests WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM staff_schedule_shifts WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM staff_schedules WHERE company_id=${f.company}`;
}
export async function historyShift(
  f: LeaveFixture,
  date: string,
  options: {
    branch?: string;
    start?: string;
    end?: string;
    timezone?: string;
    startsAt?: string;
    endsAt?: string;
  } = {},
) {
  const schedule = leaveIds.newId(),
    id = leaveIds.newId();
  const branch = options.branch ?? f.branch,
    timezone = options.timezone ?? 'UTC';
  const start = options.start ?? '09:00',
    end = options.end ?? '17:00';
  const [row] = await f.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${f.business},${branch},${f.employee.id},
      ${date}::date - ((extract(dow FROM ${date}::date)::int+1)%7),${timezone},1)
    ON CONFLICT(company_id,employee_id,branch_id,week_start) DO UPDATE SET revision=staff_schedules.revision
    RETURNING id`;
  await f.h
    .owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${f.company},${id},${row?.['id'] as string},${f.employee.id},${date},(extract(dow FROM ${date}::date)::int+1)%7,${start},${end},
      COALESCE(${options.startsAt ?? null}::timestamptz,(${date}::date+${start}::time) AT TIME ZONE ${timezone}),
      COALESCE(${options.endsAt ?? null}::timestamptz,(${date}::date+${end}::time) AT TIME ZONE ${timezone}))`;
  return id;
}
export async function historyLeave(
  f: LeaveFixture,
  date: string,
  options: {
    to?: string;
    type?: string;
    status?: string;
    branch?: string;
    kind?: string;
    timezone?: string;
  } = {},
) {
  const id = leaveIds.newId(),
    status = options.status ?? 'APPROVED';
  const decided = status === 'APPROVED' || status === 'REJECTED';
  const partial = options.kind === 'PARTIAL';
  await f.h
    .owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",
    start,"end",timezone,starts_at,ends_at,type,note,status,requested_by,requested_at,decided_by,decided_at,
    rejection_reason,cancelled_by,cancelled_at)
    VALUES(${f.company},${id},${f.business},${options.branch ?? f.branch},${f.employee.id},${options.kind ?? 'FULL_DAY'},
      ${date},${options.to ?? date},${partial ? '10:00' : null},${partial ? '12:00' : null},${options.timezone ?? 'UTC'},
      ${date}::date::timestamp AT TIME ZONE 'UTC',(${options.to ?? date}::date+1)::timestamp AT TIME ZONE 'UTC',
      ${options.type ?? 'ANNUAL'},'Synthetic history',${status},${f.userId},${historyNow},
      ${decided ? f.userId : null},${decided ? historyNow : null},${status === 'REJECTED' ? 'Synthetic rejection' : null},
      ${status === 'CANCELLED' ? f.userId : null},${status === 'CANCELLED' ? historyNow : null})`;
  return id;
}
export async function historySession(
  f: LeaveFixture,
  date: string,
  options: { branch?: string; status?: string } = {},
) {
  const id = leaveIds.newId(),
    status = options.status ?? 'OPEN';
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,status,clock_out,source,geo,late_minutes,closed_by)
    VALUES(${f.company},${id},${f.business},${options.branch ?? f.branch},${f.employee.id},${date},'UTC',
      ${date}::date::timestamp AT TIME ZONE 'UTC',${status},
      ${status === 'OPEN' ? null : `${date}T17:00:00Z`}::timestamptz,'QR','NONE',0,
      ${status === 'OPEN' ? null : status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE'})`;
  return id;
}
