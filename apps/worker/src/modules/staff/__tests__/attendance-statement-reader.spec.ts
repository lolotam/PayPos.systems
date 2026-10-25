import { afterAll, beforeAll, expect, it } from 'vitest';
import { computeAttendancePeriodReport, type ReportBranchInputs } from '@pospay/domain';
import { AttendanceStatementRequestMissing } from '../index.ts';
import {
  PERIOD_FROM,
  PERIOD_TO,
  REQUESTED_AT,
  attendanceStatementFixture,
  type AttendanceStatementFixture,
} from './attendance-statement.fixture.ts';

let f: AttendanceStatementFixture;
beforeAll(async () => {
  f = await attendanceStatementFixture();
});
afterAll(async () => {
  await f?.close();
});

const PERIOD = { from: PERIOD_FROM, to: PERIOD_TO };
const CUTOFF = REQUESTED_AT.toISOString();
const WORKING = '2026-10-01';
const WORKING_TWO = '2026-10-02';
const SHIFT_START = new Date('2026-10-01T06:00:00.000Z');
const SHIFT_END = new Date('2026-10-01T14:00:00.000Z');
const NEXT_SHIFT_START = new Date('2026-10-02T06:00:00.000Z');
const NEXT_SHIFT_END = new Date('2026-10-02T14:00:00.000Z');

/** مدخلات الموظفة اللي عندها جلسة وعقد؛ زي ما جملة 27b بتقراها بالظبط. */
function saraBranch(): ReportBranchInputs {
  return {
    timezone: 'Asia/Kuwait',
    sessions: [
      {
        working_date: WORKING,
        clock_in: SHIFT_START.toISOString(),
        clock_out: SHIFT_END.toISOString(),
        status: 'CLOSED',
        source: 'QR',
        late_minutes: 0,
        scheduled_end: null,
        clock_out_corrected: false,
        voided: false,
      },
    ],
    shifts: [
      {
        working_date: WORKING,
        starts_at: SHIFT_START.toISOString(),
        ends_at: SHIFT_END.toISOString(),
        break_starts_at: null,
        break_ends_at: null,
      },
    ],
    contract: {
      hire_date: '2026-01-01',
      contract_end: null,
      links: [{ from: '2026-01-01', to: null }],
      entries: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' })),
    },
    leave_for_branch: [],
  };
}

function branchBody(result: Awaited<ReturnType<AttendanceStatementFixture['reader']>>) {
  if (result.kind !== 'READY') throw new Error('STATEMENT_NOT_READY');
  const statement = result.data.statement;
  if (statement.form !== 'BRANCH') throw new Error('STATEMENT_NOT_BRANCH');
  return statement;
}

function employeeBody(result: Awaited<ReturnType<AttendanceStatementFixture['reader']>>) {
  if (result.kind !== 'READY') throw new Error('STATEMENT_NOT_READY');
  const statement = result.data.statement;
  if (statement.form !== 'EMPLOYEE') throw new Error('STATEMENT_NOT_EMPLOYEE');
  return statement;
}

it('the branch form gives the same figures the domain computes and keeps the schedule-only employee', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.defaultShifts(tenant, sara, [0, 1, 2, 3, 4, 5, 6]);
  await f.shift(tenant, sara, {
    workingDate: WORKING,
    day: 5,
    start: '09:00',
    end: '17:00',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
  });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const hiba = await f.employee(tenant, { nameEn: 'Hiba' });
  await f.shift(tenant, hiba, {
    workingDate: WORKING_TWO,
    day: 6,
    start: '09:00',
    end: '17:00',
    startsAt: NEXT_SHIFT_START,
    endsAt: NEXT_SHIFT_END,
  });
  const renderId = await f.request(tenant);
  const statement = branchBody(await f.reader(tenant.company, renderId));
  expect(statement.rows.map((row) => row.name)).toEqual(['سارة', 'Hiba']);
  expect(statement.businessName).toBe('صالون الأميرة');
  expect(statement.branchName).toBe('السالمية');
  expect(statement.timezone).toBe('Asia/Kuwait');
  expect(statement.period).toEqual({ from: PERIOD_FROM, to: PERIOD_TO });
  const expected = computeAttendancePeriodReport([saraBranch()], PERIOD, CUTOFF);
  const totals = statement.rows[0]?.totals;
  expect(totals?.daysPresent).toBe(expected.days_present);
  expect(totals?.workedMinutes).toBe(expected.worked_minutes);
  expect(totals?.scheduledMinutes).toBe(expected.scheduled_minutes);
  expect(totals?.contractedMinutes).toBe(expected.contracted_minutes);
  expect(totals?.differenceMinutes).toBe(expected.difference_minutes);
  expect(totals?.leave).toEqual(expected.leave);
  expect(totals?.lateCount).toBe(expected.late_count);
  expect(totals?.lateMinutes).toBe(expected.late_minutes);
  expect(totals?.missingClockOut).toBe(expected.missing_clock_out);
  expect(totals?.manualDays).toBe(expected.manual_days);
  expect(statement.rows[1]?.totals.scheduledMinutes).toBe(480);
  expect(statement.rows[1]?.totals.workedMinutes).toBe(0);
});

it('the employee form lists every date of the period and the totals of the domain', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.defaultShifts(tenant, sara, [0, 1, 2, 3, 4, 5, 6]);
  await f.shift(tenant, sara, {
    workingDate: WORKING,
    day: 5,
    start: '09:00',
    end: '17:00',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
  });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const renderId = await f.request(tenant, { form: 'EMPLOYEE', employeeId: sara, language: 'en' });
  const statement = employeeBody(await f.reader(tenant.company, renderId));
  expect(statement.employee.name).toBe('Sara');
  expect(statement.days.map((day) => day.date)).toEqual([PERIOD_FROM, WORKING_TWO, PERIOD_TO]);
  expect(statement.days[0]).toMatchObject({ worked_minutes: 480, still_in: false });
  const expected = computeAttendancePeriodReport([saraBranch()], PERIOD, CUTOFF);
  expect(statement.totals.workedMinutes).toBe(expected.worked_minutes);
  expect(statement.totals.daysPresent).toBe(expected.days_present);
});

it('the header name follows the stored identity', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const plain = await f.request(tenant);
  expect(branchBody(await f.reader(tenant.company, plain)).businessName).toBe('صالون الأميرة');
  const plainEnglish = await f.request(tenant, { language: 'en' });
  expect(branchBody(await f.reader(tenant.company, plainEnglish)).businessName).toBe(
    'Princess Salon',
  );
  await f.identity(tenant, {
    officialNameAr: 'صالون الأميرة الرسمي',
    officialNameEn: 'Official Princess Salon',
  });
  const named = await f.request(tenant);
  expect(branchBody(await f.reader(tenant.company, named)).businessName).toBe(
    'صالون الأميرة الرسمي',
  );
  const english = await f.request(tenant, { language: 'en' });
  expect(branchBody(await f.reader(tenant.company, english)).businessName).toBe(
    'Official Princess Salon',
  );
});

it('the branch name falls back from Arabic to English', async () => {
  const tenant = await f.tenant({ branchNameAr: null });
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const renderId = await f.request(tenant);
  expect(branchBody(await f.reader(tenant.company, renderId)).branchName).toBe('Salmiya');
});

it('a missing request row fails the render with the typed error', async () => {
  const tenant = await f.tenant();
  await expect(f.reader(tenant.company, f.ids.newId())).rejects.toThrow(
    AttendanceStatementRequestMissing,
  );
});

it('a request row of another tenant is invisible and fails the render', async () => {
  const mine = await f.tenant();
  const other = await f.tenant();
  const renderId = await f.request(other);
  await expect(f.reader(mine.company, renderId)).rejects.toThrow(AttendanceStatementRequestMissing);
});

it('the reader writes nothing anywhere', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const renderId = await f.request(tenant);
  const before = await f.counts(tenant.company);
  await f.reader(tenant.company, renderId);
  expect(await f.counts(tenant.company)).toEqual(before);
});

it('the logo id of the request row passes through untouched', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, sara, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const logoFileId = f.ids.newId();
  const withLogo = await f.request(tenant, { logoFileId });
  const without = await f.request(tenant);
  const logo = await f.reader(tenant.company, withLogo);
  const plain = await f.reader(tenant.company, without);
  expect(logo.kind === 'READY' ? logo.data.logoFileId : null).toBe(logoFileId);
  expect(plain.kind === 'READY' ? plain.data.logoFileId : null).toBeNull();
});

it('issue 552: a session closed between the request and the read counts as closed', async () => {
  const tenant = await f.tenant();
  const sara = await f.employee(tenant, { nameEn: 'Sara' });
  const sessionId = await f.session(tenant, sara, { workingDate: WORKING, clockIn: SHIFT_START });
  const renderId = await f.request(tenant, { requestedAt: new Date('2026-10-01T07:00:00.000Z') });
  await f.closeSession(tenant, sessionId, SHIFT_END);
  const statement = branchBody(await f.reader(tenant.company, renderId));
  expect(statement.rows[0]?.totals.workedMinutes).toBe(480);
  expect(statement.rows[0]?.totals.daysPresent).toBe(1);
});

it('issue 552: a session still open at the render prints as still clocked in', async () => {
  const tenant = await f.tenant();
  const rania = await f.employee(tenant, { nameEn: 'Rania' });
  await f.shift(tenant, rania, {
    workingDate: WORKING,
    day: 5,
    start: '09:00',
    end: '17:00',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
  });
  await f.session(tenant, rania, { workingDate: WORKING_TWO, clockIn: NEXT_SHIFT_START });
  const renderId = await f.request(tenant, { form: 'EMPLOYEE', employeeId: rania });
  const statement = employeeBody(await f.reader(tenant.company, renderId));
  expect(statement.days[1]).toMatchObject({ date: WORKING_TWO, still_in: true, worked_minutes: 0 });
  expect(statement.totals.workedMinutes).toBe(0);
});

it('issue 552: an employee whose only session is voided after the request ends empty', async () => {
  const tenant = await f.tenant();
  const salma = await f.employee(tenant, { nameEn: 'Salma' });
  const sessionId = await f.session(tenant, salma, {
    workingDate: WORKING,
    clockIn: SHIFT_START,
    clockOut: SHIFT_END,
  });
  const renderId = await f.request(tenant);
  await f.voidSession(tenant, sessionId);
  expect(await f.reader(tenant.company, renderId)).toEqual({ kind: 'EMPTY' });
});
