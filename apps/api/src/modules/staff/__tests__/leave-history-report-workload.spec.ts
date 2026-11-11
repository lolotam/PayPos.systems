import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { leaveHistoryReportQuery } from '@pospay/contracts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { historyWorkloadSql } from '../queries/leave-history-workload.sql.ts';
import {
  getBusinessLeaveHistory,
  LEAVE_HISTORY_SYNC_SCHEDULES,
} from '../queries/leave-history-report.query.ts';
import {
  historyClear,
  historyEmployee,
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
  options: { employee?: string; branch?: string; weekStart: string },
) {
  const employee = options.employee ?? fixture.employee.id;
  const branch = options.branch ?? fixture.branch;
  const scheduleId = leaveIds.newId();
  await fixture.h
    .owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${fixture.company},${scheduleId},${fixture.business},${branch},${employee},${options.weekStart},'UTC',1)`;
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
  limit = 1000,
) {
  return fixture.db.withTenant(fixture.company, async (tx) => {
    const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });
    const context = baseContext(fixture);
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Scope missing');
    const [row] = await tx.execute<{ schedules: number }>(
      historyWorkloadSql(context, scope, q, limit),
    );
    return row?.schedules ?? 0;
  });
}

it('counts a schedule at exactly from - 6 and excludes from - 7 (lower bound)', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03' });
  expect(await countWorkload(f, { from: '2026-10-09', to: '2026-10-31' })).toBe(1);
  expect(await countWorkload(f, { from: '2026-10-10', to: '2026-10-31' })).toBe(0);
});

it('counts a schedule at exactly to and excludes the next Saturday (upper bound)', async () => {
  await insertSchedule(f, { weekStart: '2026-10-17' });
  await insertSchedule(f, { weekStart: '2026-10-24' });
  expect(await countWorkload(f, { from: '2026-10-12', to: '2026-10-17' })).toBe(1);
});

it('counts a historical schedule in branch even if employee current attachment is only secondBranch', async () => {
  const employeeId = await historyEmployee(f, 'Historical transfer employee');
  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employeeId}`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${employeeId},${f.secondBranch},'2026-01-01',NULL)`;

  await insertSchedule(f, { employee: employeeId, branch: f.branch, weekStart: '2026-10-03' });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(1);
});

it('counts 2 for the same employee with schedules in two branches in the same week', async () => {
  await insertSchedule(f, { branch: f.branch, weekStart: '2026-10-03' });
  await insertSchedule(f, { branch: f.secondBranch, weekStart: '2026-10-03' });
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' })).toBe(2);
});

it('counts future schedules for a future range', async () => {
  await insertSchedule(f, { weekStart: '2027-06-05' });
  expect(await countWorkload(f, { from: '2027-06-01', to: '2027-06-30' })).toBe(1);
});

it('does not change the count when branch_id is specified in the query', async () => {
  await insertSchedule(f, { branch: f.branch, weekStart: '2026-10-03' });
  await insertSchedule(f, { branch: f.secondBranch, weekStart: '2026-10-03' });
  const withoutBranch = await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' });
  const withBranch = await countWorkload(f, {
    from: '2026-10-01',
    to: '2026-10-31',
    branch_id: f.branch,
  });
  expect(withoutBranch).toBe(2);
  expect(withBranch).toBe(2);
});

it('applies inner limit: with limit 2 and 5 schedules the result is 3', async () => {
  for (const weekStart of ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']) {
    await insertSchedule(f, { weekStart });
  }
  expect(await countWorkload(f, { from: '2026-10-01', to: '2026-10-31' }, 2)).toBe(3);
});

async function getReport(tx: Tx, q: object = {}, businessId = f.business) {
  const access = createLeaveReadAccess({ now: () => new Date('2026-10-04T10:00:00Z') });
  const query = leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q });
  return getBusinessLeaveHistory(tx, { ...baseContext(f), businessId }, query, access, 0);
}

it('refuses queries in order: no access -> feature off -> malformed cursor -> branch out of scope -> workload limit', async () => {
  await insertSchedule(f, { weekStart: '2026-10-03' });
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
  await insertSchedule(f, { weekStart: '2026-10-03' });
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
  await insertSchedule(f, { weekStart: '2026-10-03' });
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

    const refused = await getBusinessLeaveHistory(proxy, context, query, access, 0);
    expect(refused).toBe('LEAVE_HISTORY_REPORT_REQUIRED');
    expect(executed.some((statement) => statement.includes('days AS ('))).toBe(false);

    executed.length = 0;
    const passed = await getBusinessLeaveHistory(
      proxy,
      context,
      query,
      access,
      LEAVE_HISTORY_SYNC_SCHEDULES,
    );
    expect(passed).not.toBeNull();
    expect(typeof passed).toBe('object');
    expect(executed.some((statement) => statement.includes('days AS ('))).toBe(true);
  });
});
