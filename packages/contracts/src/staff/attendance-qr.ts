import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { timeZone } from '../reference/time-zone.js';

const attendanceQrTokenFields = {
  branch_id: id,
  window: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
};

export const attendanceQrToken = z
  .object(attendanceQrTokenFields)
  .strict()
  .meta({ id: 'AttendanceQrToken' });

// بيانات عرض الفرع بتشيل المفتاح الزيادة زي أي رد؛ الاستثناء بس لغلاف الإصدار اللي شايل التوقيع.
export const attendanceQrBranch = responseObject({
  id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  effective_timezone: timeZone,
}).meta({ id: 'AttendanceQrBranch' });

// غلاف إصدار الـ QR شايل توقيع الحضور، فبيفضل strict عن قصد (استثناء ADR-0047 §5): مفتاح زيادة فيه رد مش متوقع ويتحجب.
export const attendanceQrIssue = z
  .strictObject({
    token: attendanceQrToken,
    branch: attendanceQrBranch,
    server_time: timestamp,
    refresh_at: timestamp,
    expires_at: timestamp,
  })
  .meta({ id: 'AttendanceQrIssue' });

export type AttendanceQrToken = z.infer<typeof attendanceQrToken>;
export type AttendanceQrBranch = z.infer<typeof attendanceQrBranch>;
export type AttendanceQrIssue = z.infer<typeof attendanceQrIssue>;
