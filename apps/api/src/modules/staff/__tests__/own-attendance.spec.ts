import { termsFor } from './employees.fixture.ts';
import { ownAttendancePeriodAllowed } from '../domain/own-attendance-period.ts';
import { ownAttendanceContext } from '../persistence/own-attendance-context.adapter.ts';
import { staffColumns } from '../persistence/staff-columns.adapter.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  monthlyReportFixture,
  reportSession,
  voidReportSession,
  type MonthlyReportFixture,
} from './attendance-monthly-report.fixture.ts';
import { readOwnAttendance, ownAttendanceStatement } from '../queries/own-attendance.query.ts';
let f: MonthlyReportFixture;
const now = new Date('2026-10-11T10:00:00Z');
beforeAll(async () => {
  f = await monthlyReportFixture();
  await f.h
    .owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z' WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const context = () => ({
  companyId: f.company,
  businessId: f.business,
  userId: f.userId,
  branchId: f.branch,
});
const read = (query: unknown = {}) =>
  f.db.withTenant(f.company, (tx) =>
    readOwnAttendance(tx, context(), query, now, {
      periodAllowed: ownAttendancePeriodAllowed,
      context: ownAttendanceContext,
      monthsBack: staffColumns.monthsBack,
    }),
  );

it('MY14/15 projects own current times, open and missed-out rows, excluding voided rows and sensitive keys', async () => {
  const closed = await reportSession(f, { late: 7 });
  const open = await reportSession(f, { status: 'OPEN', date: '2026-10-11' });
  const missed = await reportSession(f, { status: 'MISSED_OUT', date: '2026-10-10' });
  const voided = await reportSession(f, { date: '2026-10-09' });
  await voidReportSession(f, voided);
  await f.h
    .owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},gen_random_uuid(),${f.business},${f.branch},${f.employee.id},${closed},gen_random_uuid(),'CLOCK_IN','2026-10-03T05:00:00Z','2026-10-03T06:00:00Z','Private reason',${f.userId},'2026-10-04T00:00:00Z')`;
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,branch_id,employee_id,session_id,kind,raised_at)
    VALUES(${f.company},gen_random_uuid(),${f.business},${f.branch},${f.employee.id},${missed},'SUSPECTED_MISSED_OUT','2026-10-10T18:00:00Z')`;
  const response = await read();
  expect(response.month).toBe('2026-10');
  expect(response.sessions.map((s) => s.id)).toEqual([closed, missed, open]);
  expect(response.sessions[0]).toMatchObject({
    late_minutes: 7,
    corrected: true,
    clock_in: '2026-10-03T06:00:00.000Z',
  });
  expect(response.sessions[1]?.open_exceptions).toEqual(['SUSPECTED_MISSED_OUT']);
  expect(response.sessions[2]).toMatchObject({ status: 'OPEN', clock_out: null });
  for (const row of response.sessions) {
    expect(Object.keys(row).sort()).toEqual(
      [
        'id',
        'working_date',
        'branch_name_ar',
        'branch_name_en',
        'clock_in',
        'clock_out',
        'late_minutes',
        'source',
        'status',
        'open_exceptions',
        'corrected',
      ].sort(),
    );
    for (const key of [
      'employee_id',
      'user_id',
      'reason',
      'corrected_by',
      'before',
      'after',
      'corrections',
      'geo',
      'device_id',
      'notes',
    ])
      expect(row).not.toHaveProperty(key);
  }
});
it.each([
  { month: '2026-13' },
  { employee_id: 'foreign' },
  { branch_id: 'foreign' },
  { business_id: 'foreign' },
])('rejects malformed or client subject query %j', async (query) => {
  await expect(read(query)).rejects.toMatchObject({
    code: 'month' in query ? 'VALIDATION_FAILED' : 'FORBIDDEN',
  });
});
it.each(['2026-08', '2026-11'])(
  'rejects month %s outside default two-month window',
  async (month) => {
    await expect(read({ month })).rejects.toMatchObject({ code: 'MY_PERIOD_OUT_OF_RANGE' });
  },
);
it('rechecks user link before period diagnostics', async () => {
  await f.h
    .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    await expect(read({ month: 'bad' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
  }
});
it('rechecks membership revocation inside the read transaction', async () => {
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-10T00:00:00Z' WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
it('uses the existing employee/date index on realistic own history', async () => {
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.branch},${f.employee.id},d::date,'Asia/Kuwait',d,d+interval '8 hours','CLOSED','QR','EMPLOYEE','NONE',0
    FROM generate_series('2000-01-01'::timestamptz,'2026-09-01'::timestamptz,interval '1 day') d`;
  await f.h.owner`ANALYZE attendance_sessions`;
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${ownAttendanceStatement(
        context(),
        f.employee.id,
        '2026-10',
        [
          { id: f.branch, name_ar: null, name_en: 'Synthetic branch' },
          { id: f.secondBranch, name_ar: null, name_en: 'Synthetic Hawalli' },
        ],
      )}`,
    ),
  );
  expect(JSON.stringify(plan)).toContain('attendance_sessions_employee_date_idx');
});

it.each(['business', 'tenant', 'branch'])(
  'rejects foreign %s without disclosing the period',
  async (scope) => {
    const c = {
      ...context(),
      ...(scope === 'business'
        ? { businessId: f.secondBusiness }
        : scope === 'tenant'
          ? { companyId: f.otherCompany, businessId: f.foreignBusiness }
          : { branchId: f.otherBranch }),
    };
    await expect(
      f.db.withTenant(f.company, (tx) =>
        readOwnAttendance(tx, c, { month: 'bad' }, now, {
          context: ownAttendanceContext,
          monthsBack: staffColumns.monthsBack,
          periodAllowed: ownAttendancePeriodAllowed,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  },
);
it.each(['hire', 'contract', 'deleted'])('rechecks live %s eligibility', async (kind) => {
  if (kind === 'hire')
    await f.h
      .owner`UPDATE employees SET hire_date='2026-10-12' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  if (kind === 'contract')
    await f.h
      .owner`UPDATE employees SET contract_end='2026-10-10' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  if (kind === 'deleted')
    await f.h
      .owner`UPDATE employees SET deleted_at='2026-10-10T00:00:00Z' WHERE company_id=${f.company} AND id=${f.employee.id}`;
  try {
    await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE employees SET hire_date='2026-01-01',contract_end=NULL,deleted_at=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  }
});
it('rechecks an ended branch attachment in an isolated fixture after a successful read', async () => {
  const isolated = await monthlyReportFixture();
  try {
    await isolated.h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z'
      WHERE company_id=${isolated.company} AND id=${isolated.memberId}`;
    await isolated.h.owner`UPDATE employees SET user_id=${isolated.userId}
      WHERE company_id=${isolated.company} AND id=${isolated.employee.id}`;
    const readAttached = () =>
      isolated.db.withTenant(isolated.company, (tx) =>
        readOwnAttendance(
          tx,
          {
            companyId: isolated.company,
            businessId: isolated.business,
            userId: isolated.userId,
            branchId: isolated.secondBranch,
          },
          {},
          now,
          {
            context: ownAttendanceContext,
            monthsBack: staffColumns.monthsBack,
            periodAllowed: ownAttendancePeriodAllowed,
          },
        ),
      );
    expect((await readAttached()).month).toBe('2026-10');
    await isolated.h.owner`UPDATE employee_branches SET "to"='2026-10-11'
      WHERE company_id=${isolated.company} AND employee_id=${isolated.employee.id}
      AND branch_id=${isolated.secondBranch}`;
    await expect(readAttached()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await isolated.db.close();
    await isolated.h.close();
  }
});
it('reads own history across branches while proving authority at the current branch', async () => {
  const id = await reportSession(f, { branch: f.secondBranch, date: '2026-10-05' });
  expect((await read()).sessions.map((s) => s.id)).toContain(id);
});
it('HTTP rejects admin and absent credentials without period diagnostics', async () => {
  for (const headers of [{}, { cookie: f.cookie }]) {
    const response = await f.h.app.inject({
      method: 'GET',
      url: '/v1/staff/me/attendance?month=bad',
      headers,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    expect(response.json()).not.toHaveProperty('sessions');
  }
});

it('never returns another employee sessions in the same business', async () => {
  const colleague = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f, 'Synthetic colleague'),
  });
  const foreign = await reportSession({ ...f, employee: colleague }, { date: '2026-10-06' });
  expect((await read()).sessions.map((s) => s.id)).not.toContain(foreign);
});
it('a disabled staff feature refuses even the owner before malformed period diagnostics', async () => {
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'staff',false,'Synthetic feature refusal',${f.userId})
    ON CONFLICT(company_id,flag) DO UPDATE SET enabled=false`;
  try {
    await expect(read({ month: 'bad' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
