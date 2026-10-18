import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const employee = responseObject({ id, name_ar: z.string().nullable(), name_en: z.string() });
export const attendanceDeviceRefusal = responseObject({
    id,
    employee_id: id,
    holder_employee_id: id.nullable(),
    employee,
    holder: employee.nullable(),
    branch_id: id,
    step: z.enum(['CHALLENGE', 'CLOCK', 'ENROL']),
    reason: z.enum(['DEVICE_LOCKED', 'NOT_ENROLLED', 'DEVICE_TAKEN', 'OTHER_DEVICE']),
    attempted_at: timestamp,
  })
  .meta({ id: 'AttendanceDeviceRefusal' });
export const attendanceDeviceRefusalPage = responseObject({
    items: z.array(attendanceDeviceRefusal),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'AttendanceDeviceRefusalPage' });
export type AttendanceDeviceRefusalPage = z.infer<typeof attendanceDeviceRefusalPage>;
