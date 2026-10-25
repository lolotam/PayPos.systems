import { attendanceStatementDocument } from '@pospay/contracts';
import type { AttendanceLeaveSummary } from '@pospay/domain';
import { expect, it } from 'vitest';

import { buildAttendanceStatementDocument } from '../sources/attendance-statement-document.ts';
import type { StatementBody } from '../sources/statement-ports.ts';

const CLOCK = new Date('2026-10-23T07:00:00Z');

const LEAVE: AttendanceLeaveSummary = [
  { type: 'ANNUAL', days: 1, partial_minutes: 0 },
  { type: 'SICK', days: 0, partial_minutes: 120 },
  { type: 'UNPAID', days: 0, partial_minutes: 0 },
  { type: 'OTHER', days: 0, partial_minutes: 0 },
];

function branch(contractedMinutes: number | null, differenceMinutes: number | null): StatementBody {
  return {
    form: 'BRANCH',
    language: 'ar',
    timezone: 'Asia/Kuwait',
    businessName: 'Salon',
    branchName: 'Salmiya',
    period: { from: '2026-10-01', to: '2026-10-31' },
    employeeFilter: null,
    shiftFilter: null,
    rows: [
      {
        employeeNumber: 1,
        name: 'Sara',
        totals: {
          daysPresent: 22,
          workedMinutes: 10_740,
          scheduledMinutes: 10_560,
          contractedMinutes,
          differenceMinutes,
          leave: LEAVE,
          lateCount: 1,
          lateMinutes: 20,
          missingClockOut: 0,
          manualDays: 0,
        },
      },
    ],
  };
}

function employee(): StatementBody {
  return {
    form: 'EMPLOYEE',
    language: 'en',
    timezone: 'Asia/Kuwait',
    businessName: 'Salon',
    branchName: 'Salmiya',
    period: { from: '2026-10-01', to: '2026-10-01' },
    employee: { name: 'Heba', employeeNumber: 2 },
    totals: {
      daysPresent: 1,
      workedMinutes: 480,
      scheduledMinutes: 480,
      contractedMinutes: 480,
      differenceMinutes: 0,
      leave: LEAVE,
      lateCount: 0,
      lateMinutes: 0,
      missingClockOut: 0,
      manualDays: 0,
    },
    days: [
      {
        date: '2026-10-01',
        sessions: [
          {
            clock_in: '2026-10-01T06:00:00.000Z',
            clock_out: '2026-10-01T14:00:00.000Z',
            late_minutes: 20,
            manual: false,
            counted: true,
            missing_clock_out: false,
          },
        ],
        worked_minutes: 480,
        still_in: false,
        leave: [],
        scheduled: [{ starts_at: '2026-10-01T06:00:00.000Z', ends_at: '2026-10-01T14:00:00.000Z' }],
        no_attendance: false,
      },
    ],
  };
}

it('turns the minutes of a branch row into h:mm', () => {
  const document = attendanceStatementDocument.parse(
    buildAttendanceStatementDocument({
      statement: branch(10_560, 180),
      logo: null,
      issuedAt: CLOCK,
    }),
  );
  expect(document.form).toBe('BRANCH');
  if (document.form !== 'BRANCH') return;
  const totals = document.rows[0]?.totals;
  expect(totals?.worked_hours).toBe('179:00');
  expect(totals?.scheduled_hours).toBe('176:00');
  expect(totals?.contracted_hours).toBe('176:00');
  expect(totals?.difference_hours).toBe('3:00');
  expect(totals?.leave).toEqual([
    { type: 'ANNUAL', days: 1, partial_hours: '0:00' },
    { type: 'SICK', days: 0, partial_hours: '2:00' },
    { type: 'UNPAID', days: 0, partial_hours: '0:00' },
    { type: 'OTHER', days: 0, partial_hours: '0:00' },
  ]);
});

it('keeps the sign of a negative difference', () => {
  const document = attendanceStatementDocument.parse(
    buildAttendanceStatementDocument({
      statement: branch(10_560, -320),
      logo: null,
      issuedAt: CLOCK,
    }),
  );
  if (document.form !== 'BRANCH') return;
  expect(document.rows[0]?.totals.difference_hours).toBe('-5:20');
});

it('keeps the empty contracted hours and difference of a shifted statement', () => {
  const document = attendanceStatementDocument.parse(
    buildAttendanceStatementDocument({
      statement: branch(null, null),
      logo: null,
      issuedAt: CLOCK,
    }),
  );
  if (document.form !== 'BRANCH') return;
  expect(document.rows[0]?.totals.contracted_hours).toBeNull();
  expect(document.rows[0]?.totals.difference_hours).toBeNull();
});

it('prints the day of an employee statement in the branch zone', () => {
  const document = attendanceStatementDocument.parse(
    buildAttendanceStatementDocument({
      statement: employee(),
      logo: null,
      issuedAt: CLOCK,
    }),
  );
  if (document.form !== 'EMPLOYEE') return;
  const day = document.days[0];
  expect(day?.date).toBe('October 1, 2026');
  expect(day?.worked_hours).toBe('8:00');
  expect(day?.sessions[0]?.clock_in).toBe('09:00');
  expect(day?.sessions[0]?.clock_out).toBe('17:00');
  expect(day?.scheduled[0]).toEqual({ start: '09:00', end: '17:00' });
  expect(document.totals.worked_hours).toBe('8:00');
});
