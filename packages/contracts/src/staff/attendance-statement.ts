import { z } from 'zod';

import { documentRenderErrorCode, documentRenderState } from '../documents-render.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { employeeDate } from './employee.js';

// وقت الوردية بالشكل المحلي للفرع (HH:MM)، نفس regex جدول الموظفات.
const shiftTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const count = z.number().int().nonnegative();
const employeeNumber = z.number().int().min(1).max(999999);
// الساعات بصيغة h:mm جاهزة للطباعة؛ القالب بياخد نصوص مش أرقام (AB-Q9d).
const hours = z.string().regex(/^-?\d+:[0-5]\d$/);
const leaveType = z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']);

/** نوع المستند في سجل المصادر؛ نفس الاسم اللي الـ worker بيسجل بيه (FR-010). */
export const ATTENDANCE_STATEMENT_DOCUMENT_KIND = 'attendance-statement';

/**
 * العناوين اللي القالب بيطبعها. القالب في packages/documents مالوش اعتماد على i18n (FR-015)،
 * فالمصدر بيبعت العناوين جاهزة بلغة الطلب؛ القائمة دي هي عقد المصدر مع القالب، والكتالوج
 * في i18n لازم يطابقها بالظبط.
 */
export const attendanceStatementLabelKeys = [
  'branchTitle',
  'employeeTitle',
  'periodLabel',
  'branchLabel',
  'employeeLabel',
  'employeeNumberLabel',
  'employeeFilterLabel',
  'shiftFilterLabel',
  'employeeNumber',
  'employeeName',
  'date',
  'sessions',
  'notes',
  'daysPresent',
  'workedHours',
  'scheduledHours',
  'contractedHours',
  'difference',
  'lateCount',
  'lateMinutes',
  'missingClockOut',
  'manualDays',
  'leaveAnnual',
  'leaveSick',
  'leaveUnpaid',
  'leaveOther',
  'signature',
  'employeeSignature',
  'managerSignature',
  'totalsTitle',
  'stillIn',
  'noAttendance',
  'manual',
  'footer',
  'issuedAt',
] as const;

/** مفتاح عنوان واحد من عناوين البيان المطبوعة. */
export type AttendanceStatementLabelKey = (typeof attendanceStatementLabelKeys)[number];

/**
 * الشكل مبني بنفس مفاتيح القائمة، فمفيش عنوان ينقص ولا عنوان زيادة من غير تعديل القائمة:
 * المفتاح الناقص بيرفضه الـ satisfies، والمفتاح الزائد بيرفضه فحص الخصائص الزائدة.
 */
const labelShape = {
  branchTitle: z.string().min(1),
  employeeTitle: z.string().min(1),
  periodLabel: z.string().min(1),
  branchLabel: z.string().min(1),
  employeeLabel: z.string().min(1),
  employeeNumberLabel: z.string().min(1),
  employeeFilterLabel: z.string().min(1),
  shiftFilterLabel: z.string().min(1),
  employeeNumber: z.string().min(1),
  employeeName: z.string().min(1),
  date: z.string().min(1),
  sessions: z.string().min(1),
  notes: z.string().min(1),
  daysPresent: z.string().min(1),
  workedHours: z.string().min(1),
  scheduledHours: z.string().min(1),
  contractedHours: z.string().min(1),
  difference: z.string().min(1),
  lateCount: z.string().min(1),
  lateMinutes: z.string().min(1),
  missingClockOut: z.string().min(1),
  manualDays: z.string().min(1),
  leaveAnnual: z.string().min(1),
  leaveSick: z.string().min(1),
  leaveUnpaid: z.string().min(1),
  leaveOther: z.string().min(1),
  signature: z.string().min(1),
  employeeSignature: z.string().min(1),
  managerSignature: z.string().min(1),
  totalsTitle: z.string().min(1),
  stillIn: z.string().min(1),
  noAttendance: z.string().min(1),
  manual: z.string().min(1),
  footer: z.string().min(1),
  issuedAt: z.string().min(1),
} satisfies Record<AttendanceStatementLabelKey, z.ZodString>;

/** عناوين البيان المطبوعة، جاهزة بلغة الطلب. */
export const attendanceStatementLabels = z.strictObject(labelShape);

export type AttendanceStatementLabels = z.infer<typeof attendanceStatementLabels>;

export const attendanceStatementRequest = z
  .strictObject({
    form: z.enum(['BRANCH', 'EMPLOYEE']),
    from: employeeDate,
    to: employeeDate,
    employee_id: id.optional(),
    language: z.enum(['ar', 'en']),
    shift: z.strictObject({ start: shiftTime, end: shiftTime }).optional(),
  })
  .refine((value) => value.form !== 'EMPLOYEE' || value.employee_id !== undefined, {
    message: 'employee_id is required for the employee form',
  })
  .meta({ id: 'AttendanceStatementRequest' });

export const attendanceStatementAccepted = responseObject({ render_id: id }).meta({
  id: 'AttendanceStatementAccepted',
});

export const attendanceStatementStatus = responseObject({
  state: documentRenderState,
  error_code: documentRenderErrorCode.optional(),
}).meta({ id: 'AttendanceStatementStatus' });

const statementLogo = z.strictObject({
  content_type: z.enum(['image/png', 'image/jpeg']),
  base64: z.string().min(1),
});
const statementPeriod = z.strictObject({ from: z.string(), to: z.string() });
const statementLeave = z.strictObject({
  type: leaveType,
  days: count,
  partial_hours: hours,
});
const statementTotals = z.strictObject({
  days_present: count,
  worked_hours: hours,
  scheduled_hours: hours,
  contracted_hours: hours.nullable(),
  difference_hours: hours.nullable(),
  leave: z.array(statementLeave),
  late_count: count,
  late_minutes: count,
  missing_clock_out: count,
  manual_days: count,
});

const branchStatement = z.strictObject({
  form: z.literal('BRANCH'),
  language: z.enum(['ar', 'en']),
  issued_at: z.string(),
  labels: attendanceStatementLabels,
  header: z.strictObject({
    business_name: z.string(),
    branch_name: z.string(),
    logo: statementLogo.nullable(),
    period: statementPeriod,
    employee_filter: z.strictObject({ name: z.string(), employee_number: employeeNumber }).nullable(),
    shift_filter: z.strictObject({ start: z.string(), end: z.string() }).nullable(),
  }),
  rows: z.array(
    z.strictObject({ employee_number: employeeNumber, name: z.string(), totals: statementTotals }),
  ),
});

const employeeStatement = z.strictObject({
  form: z.literal('EMPLOYEE'),
  language: z.enum(['ar', 'en']),
  issued_at: z.string(),
  labels: attendanceStatementLabels,
  header: z.strictObject({
    business_name: z.string(),
    branch_name: z.string(),
    logo: statementLogo.nullable(),
    period: statementPeriod,
    employee: z.strictObject({ name: z.string(), employee_number: employeeNumber }),
  }),
  totals: statementTotals,
  days: z.array(
    z.strictObject({
      date: z.string(),
      sessions: z.array(
        z.strictObject({
          clock_in: z.string(),
          clock_out: z.string().nullable(),
          late_minutes: count,
          manual: z.boolean(),
          missing_clock_out: z.boolean(),
        }),
      ),
      worked_hours: hours,
      still_in: z.boolean(),
      leave: z.array(leaveType),
      scheduled: z.array(z.strictObject({ start: z.string(), end: z.string() })),
      no_attendance: z.boolean(),
    }),
  ),
});

export const attendanceStatementDocument = z.discriminatedUnion('form', [
  branchStatement,
  employeeStatement,
]);

export type AttendanceStatementRequest = z.infer<typeof attendanceStatementRequest>;
export type AttendanceStatementAccepted = z.infer<typeof attendanceStatementAccepted>;
export type AttendanceStatementStatus = z.infer<typeof attendanceStatementStatus>;
export type AttendanceStatementDocument = z.infer<typeof attendanceStatementDocument>;
