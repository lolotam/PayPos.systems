import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { readStatementBranch } from '../persistence/attendance-statement-branch.ts';
import {
  attendanceStatementShiftPairsStatement,
  readAttendanceStatementShifts,
} from '../queries/attendance-statement-shifts.query.ts';
import {
  attendanceStatementApiFixture,
  type AttendanceStatementApiFixture,
} from './attendance-statement-api.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: AttendanceStatementApiFixture;
beforeAll(async () => {
  f = await attendanceStatementApiFixture();
  const week = await seedSchedule(f.branch, f.business, '2026-10-03');
  await seedShift(week, '2026-10-05', 2, '09:00', '17:00', '2026-10-05');
  await seedShift(week, '2026-10-07', 4, '22:00', '06:00', '2026-10-08');
  const next = await seedSchedule(f.branch, f.business, '2026-10-10');
  await seedShift(next, '2026-10-12', 2, '09:00', '17:00', '2026-10-12');
  const other = await seedSchedule(f.sameBusinessBranch, f.business, '2026-10-03');
  await seedShift(other, '2026-10-05', 2, '20:00', '23:00', '2026-10-05');
  const outside = await seedSchedule(f.branch, f.business, '2026-10-31');
  await seedShift(outside, '2026-11-02', 2, '07:00', '15:00', '2026-11-02');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

async function seedSchedule(branchId: string, businessId: string, weekStart: string) {
  const schedule = salaryIds.newId();
  await f.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${businessId},${branchId},${f.employee.id},${weekStart},'Asia/Kuwait',1)`;
  return schedule;
}

// الموظفة الواحدة ليها كل الورديات، فالتوقيتات ما بتقابلش نفسها (قيد عدم التراكب).
async function seedShift(
  schedule: string,
  workingDate: string,
  day: number,
  start: string,
  end: string,
  endsOn: string,
) {
  await f.h
    .owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${salaryIds.newId()},${schedule},${f.employee.id},${workingDate},${day},${start},${end},
      ${at(workingDate, start)},${at(endsOn, end)},null,null,null,null)`;
}

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

function listedShifts(period = PERIOD) {
  return f.db.withTenant(f.company, (tx) =>
    readAttendanceStatementShifts(
      tx,
      { companyId: f.company, businessId: f.business, branchId: f.branch },
      { id: f.branch, timezone: 'Asia/Kuwait' },
      period,
    ),
  );
}

it('lists the distinct shift pairs of the branch in the period, ordered by start then end', async () => {
  await expect(listedShifts()).resolves.toEqual({
    shifts: [
      { start: '09:00', end: '17:00' },
      { start: '22:00', end: '06:00' },
    ],
  });
});

it('an empty period lists no pair at all', async () => {
  await expect(listedShifts({ from: '2026-12-01', to: '2026-12-31' })).resolves.toEqual({
    shifts: [],
  });
});

it('the branch of the business comes back with its time zone, and another business branch does not', async () => {
  const branches = await f.db.withTenant(f.company, async (tx) => ({
    own: await readStatementBranch(tx, f.company, f.business, f.branch),
    sibling: await readStatementBranch(tx, f.company, f.business, f.sameBusinessBranch),
    foreign: await readStatementBranch(tx, f.company, f.business, f.foreignBranch),
  }));
  expect(branches.own).toEqual({ id: f.branch, timezone: 'Asia/Kuwait' });
  expect(branches.sibling).toEqual({ id: f.sameBusinessBranch, timezone: 'Asia/Kuwait' });
  expect(branches.foreign).toBeNull();
});

it('EXPLAIN ANALYZE reads the schedule and its shifts through their indexes', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceStatementShiftPairsStatement(
        f.company,
        f.business,
        f.branch,
        PERIOD.from,
        PERIOD.to,
        'Asia/Kuwait',
      )}`,
    );
  });
  const plan = JSON.stringify(plans);
  expect(plan).toMatch(/staff_schedules_[a-z_]+/);
  expect(plan).toMatch(/staff_schedule_shifts_[a-z_]+/);
});
