import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceStatementFixture,
  REQUESTED_AT,
  type AttendanceStatementFixture,
  type Tenant,
} from './attendance-statement.fixture.ts';

let f: AttendanceStatementFixture;
beforeAll(async () => {
  f = await attendanceStatementFixture();
});
afterAll(async () => {
  await f?.close();
});

const DATE = '2026-10-01';
const START = new Date('2026-10-01T06:00:00Z');
const END = new Date('2026-10-01T14:00:00Z');

const shift = (tenant: Tenant, employee: string) =>
  f.shift(tenant, employee, {
    workingDate: DATE,
    day: 5,
    start: '09:00',
    end: '17:00',
    startsAt: START,
    endsAt: END,
  });

async function readDay(
  tenant: Tenant,
  employeeId: string,
  requestedAt = REQUESTED_AT,
  date = DATE,
) {
  const request = await f.request(tenant, { form: 'EMPLOYEE', employeeId, requestedAt });
  const read = await f.reader(tenant.company, request);
  expect(read.kind).toBe('READY');
  if (read.kind !== 'READY' || read.data.statement.form !== 'EMPLOYEE')
    throw new Error('Expected employee reader result');
  const day = read.data.statement.days.find((row) => row.date === date);
  expect(day).toBeDefined();
  return day;
}

it('TD-1 D-a: an attended other branch in the same business does not count at the statement branch', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  const other = await f.secondBranch(tenant, employee);
  expect(other.company).toBe(tenant.company);
  expect(other.business).toBe(tenant.business);
  await shift(tenant, employee);
  await f.session(other, employee, { workingDate: DATE, clockIn: START, clockOut: END });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: [],
    still_in: false,
  });
});

it('TD-1 D-b: a pending leave does not excuse the statement absence', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  // يوم عقد عشان leave=[] يثبت استبعاد PENDING، مش مسار contract: null بتاع D-c2.
  await f.defaultShifts(tenant, employee, [5]);
  await shift(tenant, employee);
  await f.leave(tenant, employee, { from: DATE, to: DATE, status: 'PENDING' });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: [],
    still_in: false,
  });
});

it.each([
  { name: 'D-c1 contract day', contract: true, other: false, partial: false, leave: ['ANNUAL'] },
  { name: 'D-c2 schedule-only day', contract: false, other: false, partial: false, leave: [] },
  {
    name: 'D-c3 other-branch leave',
    contract: true,
    other: true,
    partial: false,
    leave: ['ANNUAL'],
  },
  { name: 'D-c4 partial leave', contract: true, other: false, partial: true, leave: ['ANNUAL'] },
])('TD-1 $name keeps the approved leave and absence characterization', async (scenario) => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  if (scenario.contract) await f.defaultShifts(tenant, employee, [5]);
  const branch = scenario.other ? await f.secondBranch(tenant, employee) : tenant;
  await shift(tenant, employee);
  await f.leave(tenant, employee, {
    from: DATE,
    to: DATE,
    type: 'ANNUAL',
    branchId: branch.branch,
    ...(scenario.partial ? { kind: 'PARTIAL', start: '10:00', end: '12:00' } : {}),
  });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: scenario.leave,
    still_in: false,
  });
});

it('TD-1 D-d: an uncorrected MISSED_OUT session remains no attendance', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await shift(tenant, employee);
  // attendance_sessions_closed_fields، migration 0072 line 69، بيفرض clock_out للجلسة المقفولة.
  await f.session(tenant, employee, {
    workingDate: DATE,
    clockIn: START,
    clockOut: END,
    status: 'MISSED_OUT',
    clockOutCorrected: false,
  });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: [],
    still_in: false,
  });
});

it.each([
  { name: 'D-e1 before hire', options: { hireDate: '2026-10-02' } },
  { name: 'D-e2 after contract end', options: { contractEnd: '2026-09-30' } },
])('TD-1 $name still returns the scheduled statement day', async ({ options }) => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, options);
  await shift(tenant, employee);
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: [],
    still_in: false,
  });
});

it('TD-1 control: an overnight shift remains on its stored working date', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee, {
    workingDate: DATE,
    day: 5,
    start: '22:00',
    end: '02:00',
    startsAt: new Date('2026-10-01T19:00:00Z'),
    endsAt: new Date('2026-10-01T23:00:00Z'),
  });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: true,
    leave: [],
    still_in: false,
    scheduled: [{ starts_at: '2026-10-01T19:00:00+00:00', ends_at: '2026-10-01T23:00:00+00:00' }],
  });
  expect(await readDay(tenant, employee, REQUESTED_AT, '2026-10-02')).toMatchObject({
    scheduled: [],
    no_attendance: false,
  });
});

it('TD-1 control: one attended shift excuses a split day', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await shift(tenant, employee);
  await f.shift(tenant, employee, {
    workingDate: DATE,
    day: 5,
    start: '18:00',
    end: '20:00',
    startsAt: new Date('2026-10-01T15:00:00Z'),
    endsAt: new Date('2026-10-01T17:00:00Z'),
  });
  await f.session(tenant, employee, { workingDate: DATE, clockIn: START, clockOut: END });
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: false,
    leave: [],
    still_in: false,
  });
});

it.each([
  { name: 'OPEN', voided: false, noAttendance: false, stillIn: true },
  { name: 'voided-only', voided: true, noAttendance: true, stillIn: false },
])('TD-1 control: $name session', async ({ voided, noAttendance, stillIn }) => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await shift(tenant, employee);
  const session = await f.session(tenant, employee, {
    workingDate: DATE,
    clockIn: START,
    ...(voided ? { clockOut: END } : {}),
  });
  if (voided) await f.voidSession(tenant, session);
  expect(await readDay(tenant, employee)).toMatchObject({
    date: DATE,
    no_attendance: noAttendance,
    leave: [],
    still_in: stillIn,
  });
});

it('TD-1 control: an unended shift alone at the cutoff returns EMPTY with no rows', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await shift(tenant, employee);
  const request = await f.request(tenant, {
    form: 'EMPLOYEE',
    employeeId: employee,
    requestedAt: START,
  });
  expect(await f.reader(tenant.company, request)).toEqual({ kind: 'EMPTY' });
});

it('TD-1 control: an unended shift is not absence in a statement with a counted day', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.session(tenant, employee, { workingDate: DATE, clockIn: START, clockOut: END });
  const nextDate = '2026-10-02';
  const cutoff = new Date('2026-10-02T06:00:00Z');
  await f.shift(tenant, employee, {
    workingDate: nextDate,
    day: 6,
    start: '09:00',
    end: '17:00',
    startsAt: cutoff,
    endsAt: new Date('2026-10-02T14:00:00Z'),
  });
  expect(await readDay(tenant, employee, cutoff, nextDate)).toMatchObject({
    date: nextDate,
    no_attendance: false,
    leave: [],
    still_in: false,
  });
});
