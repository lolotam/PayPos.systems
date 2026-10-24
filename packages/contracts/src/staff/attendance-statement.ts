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
const hours = z.string();
const leaveType = z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']);

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
  header: z.strictObject({
    business_name: z.string(),
    branch_name: z.string(),
    logo: statementLogo.nullable(),
    period: statementPeriod,
    employee_filter: z.strictObject({ name: z.string(), employee_number: employeeNumber }).nullable(),
    shift_filter: z.strictObject({ start: z.string(), end: z.string() }).nullable(),
  }),
  totals: statementTotals,
  rows: z.array(
    z.strictObject({ employee_number: employeeNumber, name: z.string(), totals: statementTotals }),
  ),
});

const employeeStatement = z.strictObject({
  form: z.literal('EMPLOYEE'),
  language: z.enum(['ar', 'en']),
  issued_at: z.string(),
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
