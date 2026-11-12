import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { leaveHistoryReportQuery } from '@pospay/contracts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { historyWorkloadSql } from '../queries/leave-history-workload.sql.ts';
import { getBusinessLeaveHistory } from '../queries/leave-history-report.query.ts';
import {
  historyClear,
  historyEmployee,
  historySyncLimits,
  leaveFixture,
  leaveIds,
  type LeaveFixture,
} from './leave-history.fixture.ts';

let f: LeaveFixture;

beforeAll(async () => {
  f = await leaveFixture();
});

beforeEach(async () => {
  await historyClear(f);
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function insertSchedule(
  fixture: LeaveFixture,
  options: {
    employee?: string;
    branch?: string;
    weekStart: string;
    shifts?: { day: number; start?: string; end?: string }[];
  },
) {
  const employee = options.employee ?? fixture.employee.id;
  const branch = options.branch ?? fixture.branch;
  const scheduleId = leaveIds.newId();
  await fixture.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${fixture.company},${scheduleId},${fixture.business},${branch},${employee},${options.weekStart},'UTC',1)`;
  for (const s of options.shifts ?? []) {
    const shiftId = leaveIds.newId();
    const start = s.start ?? '09:00';
    const end = s.end ?? '17:00';
    await fixture.h
      .owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
      VALUES(${fixture.company},${shiftId},${scheduleId},${employee},
        ${options.weekStart}::date + ${s.day}::int,${s.day}::int,${start},${end},
        (${options.weekStart}::date + ${s.day}::int + ${start}::time) AT TIME ZONE 'UTC',
        (${options.weekStart}::date + ${s.day}::int + ${end}::time) AT TIME ZONE 'UTC')`;
  }
  return scheduleId;
}

const baseContext = (fixture: LeaveFixture) => ({
  companyId: fixture.company,
  userId: fixture.userId,
  businessId: fixture.business,
  own: false,
});

async function countWorkload(
  fixture: LeaveFixture,
  q: { from: string; to: string; branch_id?: string },
  limit = 2000,
) {
  return fixture.db.withTenant(fixture.company, async (tx) => {
    const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });
    const context = baseContext(fixture);
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Scope missing');
    const [row] = await tx.execute<{ shifts: number }>(
      historyWorkloadSql(context, scope, q, limit),
    );
    return row?.shifts ?? 0;
  });
}

it.each([
  { day: 6, expected: 1 },
  { day: 5, expected: 0 },
])('lower bound: shift with day=$day counts $expected', async ({ day, expected }) => {
  await insertSchedule(f, { weekStart: '2026-10-03', shifts: [{ day }] });
  expect(await countWorkload(f, { from: '2026-10-09', to: '2026-10-31' })).toBe(expected);
});

it.each([
  { day: 0, expected: 1 },
  { day: 1, expected: 0 },
])('upper bound: shift with day=$day counts $expected', async ({ day, expected }) => {
  await insertSchedule(f, { weekStart: '2026-10-17', shifts: [{ day }] });
  expect(await countWorkload(f, { from: '2026-10-12', to: '2026-10-17' })).toBe(expected);
});

it('counts 0 for an empty schedule in range', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03' });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(0);
});

it('counts 4 for one day with 4 non-overlapping shifts', async () => {
  await insertSchedule(f, {
    weekStart: '2026-10-03',
    shifts: [
      { day: 0, start: '08:00', end: '10:00' },
      { day: 0, start: '10:30', end: '12:30' },
      { day: 0, start: '13:00', end: '15:00' },
      { day: 0, start: '15:30', end: '17:30' },
    ],
  });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(4);
});

it('counts a historical shift in branch even if employee current attachment is only secondBranch', async () => {
  const employeeId = await historyEmployee(f, 'Historical transfer employee');
  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employeeId}`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${employeeId},${f.secondBranch},'2026-01-01',NULL)`;

  await insertSchedule(f, {
    employee: employeeId,
    branch: f.branch,
    weekStart: '2026-10-03',
    shifts: [{ day: 0 }],
  });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(1);
});

it('counts both branches shifts for one employee in the same week with non-overlapping times', async () => {
  await insertSchedule(f, {
    branch: f.branch,
    weekStart: '2026-10-03',
    shifts: [{ day: 0, start: '08:00', end: '12:00' }],
  });
  await insertSchedule(f, {
    branch: f.secondBranch,
    weekStart: '2026-10-03',
    shifts: [{ day: 0, start: '13:00', end: '17:00' }],
  });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(2);
});

it('does not change the count when branch_id is specified in the query', async () => {
  await insertSchedule(f, {
    branch: f.branch,
    weekStart: '2026-10-03',
    shifts: [{ day: 0, start: '08:00', end: '12:00' }],
  });
  await insertSchedule(f, {
    branch: f.secondBranch,
    weekStart: '2026-10-03',
    shifts: [{ day: 0, start: '13:00', end: '17:00' }],
  });
  const withoutBranch = await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' });
  const withBranch = await countWorkload(f, {
    from: '2026-10-01',
    to: '2026-10-31',
    branch_id: f.branch,
  });
  expect(withoutBranch).toBe(2);
  expect(withBranch).toBe(2);
});

it('applies inner limit: with limit 2 and 5 shifts the result is 3', async () => {
  await insertSchedule(f, {
    weekStart: '2026-10-03',
    shifts: [0, 1, 2, 3, 4].map((day) => ({ day })),
  });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' }, 2)).toBe(3);
});

it('returns result shape with exactly one row whose only key is shifts as an integer', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03', shifts: [{ day: 0 }] });
  await f.db.withTenant(f.company, async (tx) => {
    const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });
    const context = baseContext(f);
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Scope missing');
    const rows = await tx.execute<Record<string, unknown>>(
      historyWorkloadSql(context, scope, { from: '2026-10-01', to: '2026-10-31' }, 100),
    );
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {})).toEqual(['shifts']);
    expect(typeof row?.['shifts']).toBe('number');
    expect(Number.isInteger(row?.['shifts'])).toBe(true);
  });
});

const shiftsRefused = { ...historySyncLimits, shifts: 0 };

async function getReport(tx: Tx, q: object = {}, businessId = f.business, limits = shiftsRefused) {
  const access = createLeaveReadAccess({ now: () => new Date('2026-10-04T10:00:00Z') });
  const query = leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q });
  return getBusinessLeaveHistory(tx, { ...baseContext(f), businessId }, query, access, limits);
}

it('refuses queries in order: no access -> feature off -> malformed cursor -> branch out of scope -> workload limit', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03', shifts: [{ day: 0 }] });
  await f.db.withTenant(f.company, async (tx) => {
    expect(await getReport(tx, {}, f.foreignBusiness)).toBeNull();

    await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
      VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
    try {
      expect(await getReport(tx)).toBe('FEATURE_DISABLED');
    } finally {
      await f.h.owner`DELETE FROM company_feature_overrides
        WHERE company_id=${f.company} AND flag='staff'`;
    }

    expect(await getReport(tx, { cursor: 'bad_cursor' })).toBe('VALIDATION_FAILED');
    expect(await getReport(tx, { branch_id: f.foreignBranch })).toBeNull();
    expect(await getReport(tx)).toBe('LEAVE_HISTORY_REPORT_REQUIRED');
  });
});

it('returns a page without refusal when employee_id or types filter is provided', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03', shifts: [{ day: 0 }] });
  await f.db.withTenant(f.company, async (tx) => {
    const withEmployee = await getReport(tx, { employee_id: f.employee.id });
    expect(withEmployee).not.toBeNull();
    expect(typeof withEmployee).toBe('object');

    const withAnnual = await getReport(tx, { 'types[]': ['ANNUAL'] });
    expect(withAnnual).not.toBeNull();
    expect(typeof withAnnual).toBe('object');
  });
});

it('a refused query never runs the history SQL, while passing query does', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03', shifts: [{ day: 0 }] });
  const dialect = new PgDialect();
  await f.db.withTenant(f.company, async (tx) => {
    const executed: string[] = [];
    const proxy = new Proxy(tx, {
      get(target, prop, receiver) {
        if (prop === 'execute') {
          return (arg: SQL) => {
            executed.push(dialect.sqlToQuery(arg).sql);
            return target.execute(arg);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const access = createLeaveReadAccess({ now: () => new Date('2026-10-04T10:00:00Z') });
    const context = baseContext(f);
    const query = leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31' });

    const refused = await getBusinessLeaveHistory(proxy, context, query, access, shiftsRefused);
    expect(refused).toBe('LEAVE_HISTORY_REPORT_REQUIRED');
    expect(executed.some((statement) => statement.includes('days AS ('))).toBe(false);

    executed.length = 0;
    const passed = await getBusinessLeaveHistory(proxy, context, query, access, historySyncLimits);
    expect(passed).not.toBeNull();
    expect(typeof passed).toBe('object');
    expect(executed.some((statement) => statement.includes('days AS ('))).toBe(true);
  });
});
