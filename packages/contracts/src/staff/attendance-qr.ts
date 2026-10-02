import { z } from 'zod';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { timeZone } from '../reference/time-zone.js';

export const attendanceQrToken = z
  .object({
    branch_id: id,
    window: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sig: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .meta({ id: 'AttendanceQrToken' });

export const attendanceQrBranch = z
  .object({
    id,
    name_ar: z.string().nullable(),
    name_en: z.string(),
    effective_timezone: timeZone,
  })
  .strict()
  .meta({ id: 'AttendanceQrBranch' });

export const attendanceQrIssue = z
  .object({
    token: attendanceQrToken,
    branch: attendanceQrBranch,
    server_time: timestamp,
    refresh_at: timestamp,
    expires_at: timestamp,
  })
  .strict()
  .meta({ id: 'AttendanceQrIssue' });

export type AttendanceQrToken = z.infer<typeof attendanceQrToken>;
export type AttendanceQrBranch = z.infer<typeof attendanceQrBranch>;
export type AttendanceQrIssue = z.infer<typeof attendanceQrIssue>;
