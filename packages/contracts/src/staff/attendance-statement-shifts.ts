import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { employeeDate } from './employee.js';

const shiftTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const DAY_MS = 86_400_000;

/** فترة منتقي الشيفت: أول وآخر يوم عمل محلي للفرع. */
export interface AttendanceStatementShiftPeriod {
  from: string;
  to: string;
}

function utcDay(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  return instant.getTime();
}

/**
 * يفحص شكل الفترة: من قبل أو مساوية لـ to، والفترة 366 يوم على الأكثر (FR-001a).
 *
 * @param period أول وآخر يوم في الفترة
 * @returns true لما الشاشة تقبل الفترة دي
 */
export function attendanceStatementShiftPeriodIsValid(
  period: AttendanceStatementShiftPeriod,
): boolean {
  const first = utcDay(period.from);
  const last = utcDay(period.to);
  if (first > last) return false;
  return (last - first) / DAY_MS + 1 <= 366;
}

export const attendanceStatementShiftsQuery = z
  .strictObject({
    from: employeeDate,
    to: employeeDate,
  })
  .refine(attendanceStatementShiftPeriodIsValid, {
    message: 'the period must be ordered and at most 366 days long',
  });

export const attendanceStatementShiftOptions = responseObject({
  shifts: z.array(z.strictObject({ start: shiftTime, end: shiftTime })),
}).meta({ id: 'AttendanceStatementShiftOptions' });

export type AttendanceStatementShiftsQuery = z.infer<typeof attendanceStatementShiftsQuery>;
export type AttendanceStatementShiftOptions = z.infer<typeof attendanceStatementShiftOptions>;
