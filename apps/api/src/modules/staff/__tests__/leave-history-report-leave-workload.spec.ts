import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { leaveHistoryReportQuery } from '@pospay/contracts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { historyLeaveWorkloadSql } from '../queries/leave-history-workload.sql.ts';
import { getBusinessLeaveHistory } from '../queries/leave-history-report.query.ts';
import {
  historyClear,
  historyEmployee,
  historyLeave,
  historySyncLimits,
  leaveFixture,
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

const baseContext = (fixture: LeaveFixture) => ({
  companyId: fixture.company,
  userId: fixture.userId,
  businessId: fixture.business,
  own: false,
});

const leavesRefused = { ...historySyncLimits, leaves: 0 };

async function getReport(tx: Tx, q: object, businessId = f.business, limits = leavesRefused) {
  const access = createLeaveReadAccess({ now: () => new Date('2026-10-04T10:00:00Z') });
  const query = leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q });
  return getBusinessLeaveHistory(tx, { ...baseContext(f), businessId }, query, access, limits);
}

async function countLeaves(q: object, limit = 100) {
  return f.db.withTenant(f.company, async (tx) => {
    const access = createLeaveReadAccess({ now: () => new Date('2026-11-07T10:00:00.000Z') });
    const context = baseContext(f);
    const scope = await access.check(tx, context);
    if (!scope) throw new Error('Scope missing');
    const query = leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q });
    const rows = await tx.execute<Record<string, unknown>>(
      historyLeaveWorkloadSql(
        context,
        query,
        scope,
        { asOf: scope.now.toISOString(), visibility: 'current' },
        limit,
      ),
    );
    return rows;
  });
}

it('leave count returns one row whose only key is leaves as an integer', async () => {
  await historyLeave(f, '2026-10-05');
  const rows = await countLeaves({});
  expect(rows.length).toBe(1);
  expect(Object.keys(rows[0] ?? {})).toEqual(['leaves']);
  expect(rows[0]?.['leaves']).toBe(1);
});

it('leave count filters by period, type, status and branch_id like the page', async () => {
  const other = await historyEmployee(f, 'Synthetic Leave Counter');
  await historyLeave(f, '2026-10-05', { type: 'ANNUAL' });
  await historyLeave(f, '2026-10-06', { type: 'SICK' });
  await historyLeave(f, '2026-10-07', { type: 'ANNUAL', status: 'PENDING' });
  await historyLeave(f, '2026-09-20', { type: 'ANNUAL' });
  await historyLeave(f, '2026-10-08', { employee: other, type: 'ANNUAL', branch: f.secondBranch });

  expect((await countLeaves({}))[0]?.['leaves']).toBe(4);
  expect((await countLeaves({ 'types[]': ['ANNUAL'] }))[0]?.['leaves']).toBe(3);
  expect((await countLeaves({ 'statuses[]': ['PENDING'] }))[0]?.['leaves']).toBe(1);
  expect((await countLeaves({ branch_id: f.branch }))[0]?.['leaves']).toBe(3);
});

it('leave count skips a soft-deleted employee, as the page does', async () => {
  const gone = await historyEmployee(f, 'Synthetic Departed Employee');
  await historyLeave(f, '2026-10-05');
  await historyLeave(f, '2026-10-06', { employee: gone });
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${gone}`;

  expect((await countLeaves({}))[0]?.['leaves']).toBe(1);
});

it('leave count applies its inner limit: with limit 1 and 3 leaves the result is 2', async () => {
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) await historyLeave(f, date);
  expect((await countLeaves({}, 1))[0]?.['leaves']).toBe(2);
});

it('leave-only filters are refused above the leave cap and served at it', async () => {
  await historyLeave(f, '2026-10-05', { type: 'ANNUAL' });
  await f.db.withTenant(f.company, async (tx) => {
    const annual = { 'types[]': ['ANNUAL'] };
    expect(await getReport(tx, annual, f.business, leavesRefused)).toBe(
      'LEAVE_HISTORY_REPORT_REQUIRED',
    );
    const atCap = await getReport(tx, annual, f.business, { ...historySyncLimits, leaves: 1 });
    expect(atCap).not.toBeNull();
    expect(typeof atCap).toBe('object');
  });
});

it('the leave cap is checked after the cursor and branch checks', async () => {
  await historyLeave(f, '2026-10-05', { type: 'ANNUAL' });
  await f.db.withTenant(f.company, async (tx) => {
    const annual = { 'types[]': ['ANNUAL'] };
    expect(await getReport(tx, annual, f.foreignBusiness, leavesRefused)).toBeNull();
    expect(
      await getReport(tx, { ...annual, cursor: 'bad_cursor' }, f.business, leavesRefused),
    ).toBe('VALIDATION_FAILED');
    expect(
      await getReport(tx, { ...annual, branch_id: f.foreignBranch }, f.business, leavesRefused),
    ).toBeNull();
  });
});

it('a leave-count refusal never runs the history SQL', async () => {
  await historyLeave(f, '2026-10-05', { type: 'ANNUAL' });
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
    expect(await getReport(proxy, { 'types[]': ['ANNUAL'] }, f.business, leavesRefused)).toBe(
      'LEAVE_HISTORY_REPORT_REQUIRED',
    );
    expect(executed.some((statement) => statement.includes('page AS ('))).toBe(false);
  });
});
