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

// نسخة الرد بتتشال منها المفاتيح الزيادة؛ مسح الـ QR لسه بيرفض المفتاح الزيادة (ADR-0047).
const attendanceQrTokenView = responseObject(attendanceQrTokenFields);

export const attendanceQrBranch = responseObject({
  id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  effective_timezone: timeZone,
}).meta({ id: 'AttendanceQrBranch' });

export const attendanceQrIssue = responseObject({
  token: attendanceQrTokenView,
  branch: attendanceQrBranch,
  server_time: timestamp,
  refresh_at: timestamp,
  expires_at: timestamp,
}).meta({ id: 'AttendanceQrIssue' });

export type AttendanceQrToken = z.infer<typeof attendanceQrToken>;
export type AttendanceQrBranch = z.infer<typeof attendanceQrBranch>;
export type AttendanceQrIssue = z.infer<typeof attendanceQrIssue>;
