import { latestAsOf, latestStatement } from './leave-history-latest-absence.fixture.ts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leaveHistoryPage } from '@pospay/contracts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { historyLastTaken } from '../queries/leave-history-last.sql.ts';
import {
  historyClear,
  historyLeave,
  historyRead,
  historySession,
  historyShift,
  historyQuery,
  leaveContext,
  leaveFixture,
  leaveIds,
  type LeaveFixture,
} from './leave-history.fixture.ts';

let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture({ hireDate: '2020-01-01' });
});
beforeEach(async () => {
  await f.h.owner`UPDATE attendance_sessions SET voided_at=NULL,voided_by=NULL,void_request_id=NULL
    WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM attendance_change_requests WHERE company_id=${f.company}`;
  await historyClear(f);
  await f.h.owner`UPDATE employees SET hire_date='2020-01-01',contract_end=NULL
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('#900: empty history has no latest absence', async () => {
  expect((await historyRead(f)).last_taken).toEqual({
    annual: null,
    sick: null,
    unpaid: null,
    unexcused_absence: null,
  });
});

it('#900: latest candidates cannot cross the requested company or business', async () => {
  await historyShift(f, '2026-11-06');
  const access = createLeaveReadAccess({ now: () => new Date(latestAsOf) });
  await f.db.withTenant(f.company, async (tx) => {
    const scope = await access.check(tx, { ...leaveContext(f), purpose: 'history' });
    if (!scope) throw new Error('LATEST_ABSENCE_SCOPE_MISSING');
    for (const context of [
      { ...leaveContext(f), businessId: f.secondBusiness },
      { ...leaveContext(f), companyId: f.otherCompany },
    ]) {
      const [row] = await tx.execute<{ absence: string | null }>(
        sql`SELECT ${historyLastTaken(context, scope, latestAsOf)}->>'unexcused_absence' AS absence`,
      );
      expect(row?.absence).toBeNull();
    }
  });
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2026-11-06');
});

it('#900: all-history maximum ignores page period, branch and status filters and cursor', async () => {
  await historyShift(f, '2020-01-01');
  await historyShift(f, '2026-11-06', { branch: f.secondBranch });
  await historyLeave(f, '2026-10-01', { status: 'REJECTED' });
  await historyLeave(f, '2026-10-02', { status: 'REJECTED' });
  const q = {
    from: '2026-10-01',
    to: '2026-10-02',
    branch_id: f.branch,
    'types[]': ['ANNUAL'],
    'statuses[]': ['REJECTED'],
    limit: 1,
  };
  const first = await historyRead(f, q);
  expect(first.items.map((r) => (r.row_type === 'LEAVE' ? r.from : r.working_date))).toEqual([
    '2026-10-02',
  ]);
  expect(first.last_taken?.unexcused_absence).toBe('2026-11-06');
  expect(first.next_cursor).toBeTypeOf('string');
  const next = await historyRead(f, { ...q, cursor: first.next_cursor });
  expect(next.items.map((r) => (r.row_type === 'LEAVE' ? r.from : r.working_date))).toEqual([
    '2026-10-01',
  ]);
  expect(next.last_taken).toEqual(first.last_taken);
});

it.each(['UTC', 'Etc/GMT+12', 'Pacific/Kiritimati'])(
  '#900: +14/-12 date inversion and exact UTC refinement boundary under DB timezone %s',
  async (databaseZone) => {
    // الأقدم كـinstant أحدث كـworking_date؛ البداية بالضبط عند حد UTC لمنتصف الليل في +14.
    await historyShift(f, '2026-11-06', {
      timezone: 'Pacific/Kiritimati',
      start: '00:00',
      end: '01:00',
    });
    await historyShift(f, '2026-11-05', {
      branch: f.secondBranch,
      timezone: 'Etc/GMT+12',
      start: '23:00',
      end: '23:30',
    });
    const [instants] = await f.h.owner`SELECT working_date::text AS date FROM staff_schedule_shifts
      WHERE company_id=${f.company} ORDER BY starts_at DESC LIMIT 1`;
    expect(instants?.['date']).toBe('2026-11-05');
    const statement = await latestStatement(f);
    const [result] = await f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SELECT set_config('TimeZone',${databaseZone},true)`);
      return tx.execute<{ last_taken: { unexcused_absence: string | null } }>(statement);
    });
    expect(result?.last_taken.unexcused_absence).toBe('2026-11-06');
  },
);

it.each([
  { date: '2026-03-08', start: '01:00', end: '04:00' },
  { date: '2026-11-01', start: '00:30', end: '02:30' },
])('#900: DST day $date retains the materialized working date', async ({ date, start, end }) => {
  await historyShift(f, date, { start, end, timezone: 'America/New_York' });
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe(date);
});

it('#900: touching intervals preserve the maximum working date across the UTC date bound', async () => {
  await historyShift(f, '2026-11-06', {
    start: '00:00',
    end: '01:00',
    timezone: 'Pacific/Kiritimati',
  });
  await historyShift(f, '2026-11-04', {
    branch: f.secondBranch,
    start: '23:00',
    end: '23:30',
    timezone: 'Etc/GMT+12',
  });
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2026-11-06');
});

it('#900: overnight/split day qualifies at first ended shift, including exact as_of equality', async () => {
  await historyShift(f, '2026-11-05', {
    start: '22:00',
    end: '02:00',
    endsAt: '2026-11-06T02:00:00Z',
  });
  await historyShift(f, '2026-11-05', { start: '09:00', end: '12:00' });
  expect(
    (await historyRead(f, {}, '2026-11-05T11:59:59.999Z')).last_taken?.unexcused_absence,
  ).toBeNull();
  const atEnd = await historyRead(f, {}, '2026-11-05T12:00:00.000Z');
  expect(atEnd.last_taken?.unexcused_absence).toBe('2026-11-05');
  const absent = atEnd.items.find((r) => r.row_type === 'UNEXCUSED_ABSENCE');
  expect(absent?.shifts).toEqual([
    { start: '09:00', end: '12:00' },
    { start: '22:00', end: '02:00' },
  ]);
});

it('#900: employment bounds exclude earlier/later days but include both endpoints', async () => {
  for (const date of ['2020-01-01', '2026-10-01', '2026-10-02', '2026-11-06'])
    await historyShift(f, date);
  await f.h.owner`UPDATE employees SET hire_date='2026-10-01',contract_end='2026-10-02'
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2026-10-02');
  await historySession(f, '2026-10-02', { status: 'CLOSED' });
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2026-10-01');
  await historySession(f, '2026-10-01', { status: 'CLOSED' });
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBeNull();
});

it.each(['APPROVED', 'PENDING'])(
  '#900: hidden-branch %s partial leave suppresses latest day',
  async (status) => {
    await historyShift(f, '2020-01-01');
    await historyShift(f, '2026-11-06');
    await historyLeave(f, '2026-11-06', { branch: f.secondBranch, status, kind: 'PARTIAL' });
    await hideSecondBranch();
    const page = await historyRead(f);
    expect(page.last_taken?.unexcused_absence).toBe('2020-01-01');
    expect(page.items.every((r) => r.branch_id === f.branch)).toBe(true);
    expect(page.items.some((r) => r.row_type === 'LEAVE')).toBe(false);
  },
);

it.each(['OPEN', 'CLOSED', 'MISSED_OUT'])(
  '#900: hidden-branch %s session covers latest date',
  async (status) => {
    await historyShift(f, '2020-01-01');
    await historyShift(f, '2026-11-06');
    await historySession(f, '2026-11-06', { branch: f.secondBranch, status });
    await hideSecondBranch();
    expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2020-01-01');
  },
);

it('#900: voided hidden-branch session cannot suppress latest absence', async () => {
  await historyShift(f, '2026-11-06');
  const session = await historySession(f, '2026-11-06', {
    branch: f.secondBranch,
    status: 'CLOSED',
  });
  const request = leaveIds.newId();
  await f.h.owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,
    employee_id,kind,status,session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${request},${f.business},${f.secondBranch},${f.employee.id},
      'VOID_SESSION','APPROVED',${session},0,'Synthetic void',${f.userId},${latestAsOf},${f.userId},${latestAsOf})`;
  await f.h
    .owner`UPDATE attendance_sessions SET voided_at=${latestAsOf},voided_by=${f.userId},void_request_id=${request}
    WHERE company_id=${f.company} AND id=${session}`;
  await hideSecondBranch();
  expect((await historyRead(f)).last_taken?.unexcused_absence).toBe('2026-11-06');
});

it('#900: cursor saves ended-shift as_of even when the later request clock advances', async () => {
  await historyShift(f, '2026-11-05');
  await historyShift(f, '2026-11-06');
  await historyShift(f, '2026-11-07', { start: '09:00', end: '11:00' });
  const first = await historyRead(f, { limit: 1 });
  expect(first.next_cursor).toBeTypeOf('string');
  const next = await historyRead(
    f,
    { limit: 1, cursor: first.next_cursor },
    '2026-11-07T12:00:00.000Z',
  );
  expect(next.as_of).toBe(first.as_of);
  expect(next.last_taken?.unexcused_absence).toBe('2026-11-06');
  expect((await historyRead(f, {}, '2026-11-07T12:00:00.000Z')).last_taken?.unexcused_absence).toBe(
    '2026-11-07',
  );
});

it('#900: full page and latest fragment use non-UTC session without changing result', async () => {
  await historyShift(f, '2026-11-06', {
    timezone: 'Pacific/Kiritimati',
    start: '00:00',
    end: '01:00',
  });
  const page = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL TIME ZONE 'Etc/GMT+12'`);
    return leaveHistoryPage.parse(
      await getEmployeeLeaveHistory(
        tx,
        leaveContext(f),
        historyQuery(),
        createLeaveReadAccess({ now: () => new Date(latestAsOf) }),
      ),
    );
  });
  expect(page.items[0]).toMatchObject({
    row_type: 'UNEXCUSED_ABSENCE',
    working_date: '2026-11-06',
  });
  expect(page.last_taken?.unexcused_absence).toBe('2026-11-06');
});

async function hideSecondBranch() {
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
}
