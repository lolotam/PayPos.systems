import { expect, it } from 'vitest';
import { documentRenderErrorCode } from '../documents-render.js';
import {
  attendanceStatementAccepted,
  attendanceStatementDocument,
  attendanceStatementLabelKeys,
  attendanceStatementRequest,
  attendanceStatementStatus,
} from './attendance-statement.js';

const employeeId = '01920000-0000-7000-8000-0000000000a1';
const labels = {
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
const totals = {
  days_present: 22,
  worked_hours: '179:00',
  scheduled_hours: '176:00',
  contracted_hours: '176:00',
  difference_hours: '3:00',
  leave: [{ type: 'ANNUAL', days: 1, partial_hours: '0:00' }],
  late_count: 1,
  late_minutes: 20,
  missing_clock_out: 0,
  manual_days: 0,
};
const branchDocument = {
  form: 'BRANCH',
  language: 'ar',
  issued_at: '2/11/2026 10:14',
  labels,
  header: {
    business_name: 'صالون الأميرة',
    branch_name: 'فرع السالمية',
    logo: { content_type: 'image/png', base64: 'iVBORw0KGgo=' },
    period: { from: '1/10/2026', to: '31/10/2026' },
    employee_filter: null,
    shift_filter: null,
  },
  rows: [{ employee_number: 1, name: 'سارة', totals }],
};
const employeeDocument = {
  form: 'EMPLOYEE',
  language: 'en',
  issued_at: '2/11/2026 10:14',
  labels,
  header: {
    business_name: 'Salon Al Amira',
    branch_name: 'Salmiya branch',
    logo: null,
    period: { from: '1/10/2026', to: '15/10/2026' },
    employee: { name: 'Heba', employee_number: 2 },
  },
  totals,
  days: [
    {
      date: '1/10/2026',
      sessions: [{ clock_in: '09:00', clock_out: '17:00', late_minutes: 0, manual: false, missing_clock_out: false }],
      worked_hours: '8:00',
      still_in: false,
      leave: [],
      scheduled: [{ start: '09:00', end: '17:00' }],
      no_attendance: false,
    },
  ],
};

it('a branch request without an employee passes', () => {
  expect(attendanceStatementRequest.parse({
    form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'ar',
  })).toMatchObject({ form: 'BRANCH' });
});
it('the employee form refuses a request without an employee', () => {
  expect(attendanceStatementRequest.safeParse({
    form: 'EMPLOYEE', from: '2026-10-01', to: '2026-10-31', language: 'ar',
  }).success).toBe(false);
});
it('a branch request with an employee and a shift pair passes', () => {
  expect(attendanceStatementRequest.parse({
    form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'en',
    employee_id: employeeId, shift: { start: '09:00', end: '20:00' },
  })).toMatchObject({ employee_id: employeeId });
});
it('the request refuses an unknown key and a bad shift time and a bad language', () => {
  expect(attendanceStatementRequest.safeParse({
    form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'ar', branch_id: employeeId,
  }).success).toBe(false);
  expect(attendanceStatementRequest.safeParse({
    form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'ar', shift: { start: '9:00', end: '20:00' },
  }).success).toBe(false);
  expect(attendanceStatementRequest.safeParse({
    form: 'BRANCH', from: '2026-10-01', to: '2026-10-31', language: 'fr',
  }).success).toBe(false);
});
it('a shift on the employee form passes the schema and the use case refuses it', () => {
  expect(attendanceStatementRequest.safeParse({
    form: 'EMPLOYEE', from: '2026-10-01', to: '2026-10-31', language: 'ar',
    employee_id: employeeId, shift: { start: '09:00', end: '20:00' },
  }).success).toBe(true);
});
it('a period that ends before it starts passes the schema and the use case refuses it', () => {
  expect(attendanceStatementRequest.safeParse({
    form: 'BRANCH', from: '2026-10-31', to: '2026-10-01', language: 'ar',
  }).success).toBe(true);
});
it('the accepted reply carries the render id and the status carries a known state', () => {
  expect(attendanceStatementAccepted.parse({ render_id: employeeId })).toEqual({ render_id: employeeId });
  for (const state of ['QUEUED', 'RENDERING', 'READY', 'FAILED', 'EXPIRED', 'CONSUMED']) {
    expect(attendanceStatementStatus.parse({ state })).toEqual({ state });
  }
  for (const error_code of documentRenderErrorCode.options) {
    expect(attendanceStatementStatus.safeParse({ state: 'FAILED', error_code }).success).toBe(true);
  }
  expect(attendanceStatementStatus.safeParse({ state: 'QUEUED', error_code: 'NOT_A_CODE' }).success).toBe(false);
});
it('both statement forms parse with their rows and days', () => {
  expect(attendanceStatementDocument.parse(branchDocument)).toMatchObject({ form: 'BRANCH' });
  expect(attendanceStatementDocument.parse(employeeDocument)).toMatchObject({ form: 'EMPLOYEE' });
});
it('a filtered statement parses with null contracted and difference hours', () => {
  const filtered = {
    ...branchDocument,
    header: { ...branchDocument.header, shift_filter: { start: '09:00', end: '20:00' } },
    rows: [{ employee_number: 1, name: 'سارة', totals: { ...totals, contracted_hours: null, difference_hours: null } }],
  };
  expect(attendanceStatementDocument.parse(filtered)).toMatchObject({
    rows: [{ totals: { contracted_hours: null, difference_hours: null } }],
  });
});
it('the branch form refuses a branch-wide totals row it does not have', () => {
  expect(attendanceStatementDocument.safeParse({ ...branchDocument, totals }).success).toBe(false);
});
it('the document refuses hours that are not in the h:mm form', () => {
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    rows: [{ ...branchDocument.rows[0], totals: { ...totals, worked_hours: '8' } }],
  }).success).toBe(false);
  expect(attendanceStatementDocument.safeParse({
    ...employeeDocument,
    totals: { ...totals, difference_hours: 'later' },
  }).success).toBe(false);
});
it('the document refuses an extra key on the rows, the header and the days', () => {
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    rows: [{ ...branchDocument.rows[0], employee_id: employeeId }],
  }).success).toBe(false);
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    header: { ...branchDocument.header, phone: '+96550000000' },
  }).success).toBe(false);
  expect(attendanceStatementDocument.safeParse({
    ...employeeDocument,
    days: [{ ...employeeDocument.days[0], phone: '+96550000000' }],
  }).success).toBe(false);
});
it('the document refuses a logo of another content type', () => {
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    header: { ...branchDocument.header, logo: { content_type: 'image/gif', base64: 'R0lGOD' } },
  }).success).toBe(false);
});
it('the document refuses missing labels and labels it does not know', () => {
  expect(attendanceStatementDocument.safeParse({ ...branchDocument, labels: undefined }).success).toBe(false);
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    labels: { ...labels, extra: 'زيادة' },
  }).success).toBe(false);
  expect(attendanceStatementDocument.safeParse({
    ...branchDocument,
    labels: { ...labels, stillIn: '' },
  }).success).toBe(false);
});
it('the label keys are the ones the template prints, and both forms take them', () => {
  expect(Object.keys(labels).sort()).toEqual([...attendanceStatementLabelKeys].sort());
  expect(attendanceStatementDocument.parse(branchDocument).labels).toEqual(labels);
  expect(attendanceStatementDocument.parse(employeeDocument).labels).toEqual(labels);
});
