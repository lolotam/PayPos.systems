import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

export const attendanceDeviceRefusal = z
  .strictObject({
    id,
    employee_id: id,
    holder_employee_id: id.nullable(),
    branch_id: id,
    step: z.enum(['CHALLENGE', 'CLOCK', 'ENROL']),
    reason: z.enum(['DEVICE_LOCKED', 'NOT_ENROLLED', 'DEVICE_TAKEN', 'OTHER_DEVICE']),
    attempted_at: timestamp,
  })
  .meta({ id: 'AttendanceDeviceRefusal' });
export const attendanceDeviceRefusalPage = z
  .strictObject({
    items: z.array(attendanceDeviceRefusal),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'AttendanceDeviceRefusalPage' });
export type AttendanceDeviceRefusalPage = z.infer<typeof attendanceDeviceRefusalPage>;
