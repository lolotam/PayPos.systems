import { z } from 'zod';
import { id } from '../scalars/id.js';

export const attendanceEmployeeCursor = z.tuple([z.string().min(1).max(255), id]);
const cursor = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return attendanceEmployeeCursor.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  });
export const attendanceEmployeesQuery = z
  .strictObject({
    search: z.string().trim().max(100).optional(),
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'AttendanceEmployeesQuery' });
export const attendanceEmployee = z
  .strictObject({ id, name_ar: z.string().nullable(), name_en: z.string() })
  .meta({ id: 'AttendanceEmployee' });
export const attendanceEmployeePage = z
  .strictObject({ items: z.array(attendanceEmployee), next_cursor: cursor.nullable() })
  .meta({ id: 'AttendanceEmployeePage' });
export type AttendanceEmployeesQuery = z.infer<typeof attendanceEmployeesQuery>;
export type AttendanceEmployeePage = z.infer<typeof attendanceEmployeePage>;
