import type { AttendanceStatementDocument } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { attendanceStatementHtml } from '../templates/attendance-statement.ts';

// عناوين البيان بالإنجليزي؛ القالب مالوش اعتماد على i18n (FR-015)، فالنص هنا واجهة اختبار.
const ENGLISH_LABELS = {
  branchTitle: 'Branch statement',
  employeeTitle: 'Employee statement',
  periodLabel: 'Period',
  branchLabel: 'Branch',
  employeeLabel: 'Employee',
  employeeNumberLabel: 'Employee number',
  employeeFilterLabel: 'Employee filter',
  shiftFilterLabel: 'Shift filter',
  employeeNumber: 'Employee number',
  employeeName: 'Employee name',
  date: 'Date',
  sessions: 'Sessions',
  notes: 'Notes',
  daysPresent: 'Days present',
  workedHours: 'Worked hours',
  scheduledHours: 'Scheduled hours',
  contractedHours: 'Contracted hours',
  difference: 'Difference',
  lateCount: 'Late count',
  lateMinutes: 'Late minutes',
  missingClockOut: 'Missing clock-out',
  manualDays: 'Manual days',
  leaveAnnual: 'Annual leave',
  leaveSick: 'Sick leave',
  leaveUnpaid: 'Unpaid leave',
  leaveOther: 'Other leave',
  signature: 'Signature',
  employeeSignature: 'Employee signature',
  managerSignature: 'Manager signature',
  totalsTitle: 'Totals',
  stillIn: 'Still clocked in',
  noAttendance: 'No attendance recorded',
  manual: 'Manual',
  footer: 'Issued by the PosPay attendance system',
  issuedAt: 'Issued at',
};

type EmployeeDay = Extract<AttendanceStatementDocument, { form: 'EMPLOYEE' }>['days'][number];

const MISSED_OUT_SESSION = {
  clock_in: '10:00',
  clock_out: null,
  late_minutes: 0,
  manual: false,
  missing_clock_out: true,
};

const COUNTED_SESSION = {
  clock_in: '10:00',
  clock_out: '12:00',
  late_minutes: 0,
  manual: false,
  missing_clock_out: false,
};

/** يوم في جدول الأيام؛ الافتراض يوم فاضي، وكل اختبار بيغيّر اللي محتاجه بس. */
function day(overrides: Partial<EmployeeDay> & { readonly date: string }): EmployeeDay {
  return {
    date: overrides.date,
    sessions: overrides.sessions ?? [],
    worked_hours: overrides.worked_hours ?? '0:00',
    still_in: overrides.still_in ?? false,
    leave: overrides.leave ?? [],
    scheduled: overrides.scheduled ?? [],
    no_attendance: overrides.no_attendance ?? false,
  };
}

function employeeDocument(days: EmployeeDay[]): AttendanceStatementDocument {
  return {
    form: 'EMPLOYEE',
    language: 'en',
    issued_at: '2/11/2026 10:14',
    labels: ENGLISH_LABELS,
    header: {
      business_name: 'Princess Salon',
      branch_name: 'Salmiya',
      logo: null,
      period: { from: '1/10/2026', to: '15/10/2026' },
      employee: { name: 'Heba', employee_number: 2 },
    },
    totals: {
      days_present: 10,
      worked_hours: '80:00',
      scheduled_hours: '80:00',
      contracted_hours: '80:00',
      difference_hours: '0:00',
      leave: [{ type: 'SICK', days: 1, partial_hours: '1:30' }],
      late_count: 1,
      late_minutes: 20,
      missing_clock_out: 1,
      manual_days: 0,
    },
    days,
  };
}

/** صف اليوم في جدول الأيام؛ بياخد خلايا الصف بس من غير كتل التوقيعات. */
function dayRow(page: string, date: string): string {
  const start = page.indexOf(`<bdi>${date}</bdi>`);
  if (start < 0) return '';
  const from = page.lastIndexOf('<tr>', start);
  const to = page.indexOf('</tr>', start);
  return page.slice(from, to);
}

it('prints only the date on a day with no session, no leave and no ended shift', () => {
  const page = attendanceStatementHtml(employeeDocument([day({ date: '3/10/2026' })]));
  const row = dayRow(page, '3/10/2026');
  expect(row).toContain('3/10/2026');
  expect(row).not.toContain('0:00');
  expect(row).not.toContain('No attendance recorded');
});

it('prints the zero hours of a day the employee is still clocked in', () => {
  const page = attendanceStatementHtml(
    employeeDocument([day({ date: '5/10/2026', still_in: true })]),
  );
  const row = dayRow(page, '5/10/2026');
  expect(row).toContain('Still clocked in');
  expect(row).toContain('0:00');
});

it('prints the scheduled times beside a missing clock-out and no attendance', () => {
  const page = attendanceStatementHtml(
    employeeDocument([
      day({
        date: '2/10/2026',
        sessions: [MISSED_OUT_SESSION],
        scheduled: [{ start: '09:00', end: '17:00' }],
        no_attendance: true,
      }),
    ]),
  );
  const row = dayRow(page, '2/10/2026');
  expect(row).toContain('Missing clock-out');
  expect(row).toContain('10:00');
  expect(row).toContain('09:00');
  expect(row).toContain('17:00');
  expect(row).toContain('No attendance recorded');
});

it('prints no scheduled times on a day with a counted session', () => {
  const page = attendanceStatementHtml(
    employeeDocument([
      day({
        date: '4/10/2026',
        sessions: [COUNTED_SESSION],
        worked_hours: '2:00',
        scheduled: [{ start: '09:00', end: '17:00' }],
      }),
    ]),
  );
  const row = dayRow(page, '4/10/2026');
  expect(row).toContain('2:00');
  expect(row).not.toContain('09:00');
  expect(row).not.toContain('17:00');
});
