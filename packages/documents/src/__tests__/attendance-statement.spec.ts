import type { AttendanceStatementDocument } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { attendanceStatementHtml } from '../templates/attendance-statement.ts';

const ARABIC_LABELS = {
  branchTitle: 'بيان الفرع',
  employeeTitle: 'بيان الموظفة',
  periodLabel: 'الفترة',
  branchLabel: 'الفرع',
  employeeLabel: 'الموظفة',
  employeeNumberLabel: 'رقم الموظف',
  employeeFilterLabel: 'فلتر الموظفة',
  shiftFilterLabel: 'فلتر الوردية',
  employeeNumber: 'رقم الموظف',
  employeeName: 'اسم الموظفة',
  date: 'التاريخ',
  sessions: 'الجلسات',
  notes: 'ملاحظات',
  daysPresent: 'أيام الحضور',
  workedHours: 'ساعات العمل',
  scheduledHours: 'ساعات الجدول',
  contractedHours: 'الساعات المتفق عليها',
  difference: 'الفرق',
  lateCount: 'عدد التأخير',
  lateMinutes: 'دقائق التأخير',
  missingClockOut: 'ناقص بصمة خروج',
  manualDays: 'أيام يدوية',
  leaveAnnual: 'إجازة سنوية',
  leaveSick: 'إجازة مرضية',
  leaveUnpaid: 'إجازة بدون راتب',
  leaveOther: 'إجازة أخرى',
  signature: 'التوقيع',
  employeeSignature: 'توقيع الموظفة',
  managerSignature: 'توقيع المدير',
  totalsTitle: 'الإجماليات',
  stillIn: 'لسه جوّه',
  noAttendance: 'لا يوجد حضور مسجّل',
  manual: 'يدوي',
  footer: 'صادر من نظام PosPay للحضور والانصراف',
  issuedAt: 'تاريخ الإصدار',
};

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

const HOSTILE_NAME = `<script>alert(1)</script> "quoted" & more`;
const HOSTILE_BASE64 = '"><script>alert(1)</script>';

const PHYSICAL_CSS =
  /(?:margin|padding|border)-(?:left|right)\b|(?:^|[^-])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)/;

interface BranchOptions {
  readonly language?: 'ar' | 'en';
  readonly logo?: {
    readonly content_type: 'image/png' | 'image/jpeg';
    readonly base64: string;
  } | null;
  readonly contracted_hours?: string | null;
  readonly difference_hours?: string | null;
  readonly employeeName?: string;
}

interface EmployeeOptions {
  readonly language?: 'ar' | 'en';
  readonly logo?: {
    readonly content_type: 'image/png' | 'image/jpeg';
    readonly base64: string;
  } | null;
  readonly stillIn?: boolean;
  readonly noAttendance?: boolean;
  readonly employeeName?: string;
}

function branchDocument(options: BranchOptions = {}): AttendanceStatementDocument {
  const labels = options.language === 'en' ? ENGLISH_LABELS : ARABIC_LABELS;
  const contracted = options.contracted_hours === undefined ? '176:00' : options.contracted_hours;
  const difference = options.difference_hours === undefined ? '3:00' : options.difference_hours;
  return {
    form: 'BRANCH',
    language: options.language ?? 'ar',
    issued_at: '2/11/2026 10:14',
    labels,
    header: {
      business_name: 'صالون الأميرة',
      branch_name: 'فرع السالمية',
      logo: options.logo ?? null,
      period: { from: '1/10/2026', to: '31/10/2026' },
      employee_filter: null,
      shift_filter: null,
    },
    rows: [
      {
        employee_number: 1,
        name: options.employeeName ?? 'سارة',
        totals: {
          days_present: 22,
          worked_hours: '179:00',
          scheduled_hours: '176:00',
          contracted_hours: contracted,
          difference_hours: difference,
          leave: [{ type: 'ANNUAL' as const, days: 1, partial_hours: '0:00' }],
          late_count: 1,
          late_minutes: 20,
          missing_clock_out: 0,
          manual_days: 0,
        },
      },
    ],
  };
}

function employeeDocument(options: EmployeeOptions = {}): AttendanceStatementDocument {
  const labels = options.language === 'en' ? ENGLISH_LABELS : ARABIC_LABELS;
  return {
    form: 'EMPLOYEE',
    language: options.language ?? 'ar',
    issued_at: '2/11/2026 10:14',
    labels,
    header: {
      business_name: 'صالون الأميرة',
      branch_name: 'فرع السالمية',
      logo: options.logo ?? null,
      period: { from: '1/10/2026', to: '15/10/2026' },
      employee: { name: options.employeeName ?? 'هبة', employee_number: 2 },
    },
    totals: {
      days_present: 10,
      worked_hours: '80:00',
      scheduled_hours: '80:00',
      contracted_hours: '80:00',
      difference_hours: '0:00',
      leave: [{ type: 'SICK' as const, days: 1, partial_hours: '1:30' }],
      late_count: 1,
      late_minutes: 20,
      missing_clock_out: 1,
      manual_days: 0,
    },
    days: [
      {
        date: '1/10/2026',
        sessions: [
          {
            clock_in: '09:00',
            clock_out: '17:00',
            late_minutes: 20,
            manual: false,
            missing_clock_out: false,
          },
        ],
        worked_hours: '8:00',
        still_in: options.stillIn ?? false,
        leave: [],
        scheduled: [{ start: '09:00', end: '17:00' }],
        no_attendance: options.noAttendance ?? false,
      },
    ],
  };
}

it('escapes a name with a script, quotes and an ampersand in both forms', () => {
  const branch = attendanceStatementHtml(branchDocument({ employeeName: HOSTILE_NAME }));
  const employee = attendanceStatementHtml(employeeDocument({ employeeName: HOSTILE_NAME }));
  for (const page of [branch, employee]) {
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).toContain('&quot;quoted&quot;');
    expect(page).toContain('&amp; more');
    expect(page).not.toContain('<script');
    expect(page).not.toContain(HOSTILE_NAME);
  }
});

it('prints no external URL and no script in either form', () => {
  for (const page of [
    attendanceStatementHtml(branchDocument()),
    attendanceStatementHtml(employeeDocument()),
  ]) {
    expect(page).not.toContain('http://');
    expect(page).not.toContain('https://');
    expect(page).not.toContain('<script');
  }
});

it('sets the language and the direction of the document', () => {
  expect(attendanceStatementHtml(branchDocument({ language: 'ar' }))).toContain(
    '<html lang="ar" dir="rtl">',
  );
  expect(attendanceStatementHtml(employeeDocument({ language: 'en' }))).toContain(
    '<html lang="en" dir="ltr">',
  );
});

it('prints both signature places and the owner footer in both languages', () => {
  const arabicBranch = attendanceStatementHtml(branchDocument({ language: 'ar' }));
  expect(arabicBranch).toContain('التوقيع');
  expect(arabicBranch).toContain('توقيع المدير');
  expect(arabicBranch).toContain('صادر من نظام PosPay للحضور والانصراف');

  const englishBranch = attendanceStatementHtml(branchDocument({ language: 'en' }));
  expect(englishBranch).toContain('Signature');
  expect(englishBranch).toContain('Manager signature');
  expect(englishBranch).toContain('Issued by the PosPay attendance system');

  const arabicEmployee = attendanceStatementHtml(employeeDocument({ language: 'ar' }));
  expect(arabicEmployee).toContain('توقيع الموظفة');
  expect(arabicEmployee).toContain('توقيع المدير');
  expect(arabicEmployee).toContain('صادر من نظام PosPay للحضور والانصراف');

  const englishEmployee = attendanceStatementHtml(employeeDocument({ language: 'en' }));
  expect(englishEmployee).toContain('Employee signature');
  expect(englishEmployee).toContain('Manager signature');
  expect(englishEmployee).toContain('Issued by the PosPay attendance system');
});

it('embeds the logo as a data URI built from its bytes', () => {
  const page = attendanceStatementHtml(
    branchDocument({
      logo: { content_type: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') },
    }),
  );
  expect(page).toContain('data:image/png;base64,AQID');
  expect(page).toContain('<img');
});

it('never lets a hostile logo string reach the markup', () => {
  const page = attendanceStatementHtml(
    branchDocument({ logo: { content_type: 'image/png', base64: HOSTILE_BASE64 } }),
  );
  expect(page).toContain('data:image/png;base64,');
  expect(page).not.toContain(HOSTILE_BASE64);
  expect(page).not.toContain('<script');
});

it('prints no image at all when the business has no logo', () => {
  expect(attendanceStatementHtml(branchDocument({ logo: null }))).not.toContain('<img');
  expect(attendanceStatementHtml(employeeDocument({ logo: null }))).not.toContain('<img');
});

it('never prints the no-attendance note on a day the employee is still clocked in', () => {
  const page = attendanceStatementHtml(employeeDocument({ stillIn: true, noAttendance: true }));
  expect(page).toContain('لسه جوّه');
  expect(page).not.toContain('لا يوجد حضور مسجّل');
});

it('prints a dash for the contracted hours and the difference a shift filter leaves empty', () => {
  const empty = attendanceStatementHtml(
    branchDocument({ contracted_hours: null, difference_hours: null }),
  );
  expect(empty).toContain('—');
  const filled = attendanceStatementHtml(branchDocument());
  expect(filled).not.toContain('—');
});

it('prints the branch statement on a landscape page and the employee statement upright', () => {
  expect(attendanceStatementHtml(branchDocument())).toContain(
    '@page { size: A4 landscape; margin: 12mm; }',
  );
  expect(attendanceStatementHtml(employeeDocument())).not.toContain('A4 landscape');
});

it('uses logical CSS only in both forms', () => {
  for (const page of [
    attendanceStatementHtml(branchDocument()),
    attendanceStatementHtml(employeeDocument()),
  ]) {
    expect(page).not.toMatch(PHYSICAL_CSS);
    expect(page).not.toContain('margin-left');
    expect(page).not.toContain('margin-right');
    expect(page).not.toContain('padding-left');
    expect(page).not.toContain('padding-right');
  }
});
