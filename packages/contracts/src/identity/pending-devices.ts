import { z } from 'zod';

import { pageQuery } from '../pagination/cursor.js';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { deviceCheckCode } from './devices.js';

// الأجهزة اللي مستنية موافقة الـ manager في فرع واحد (spec 070): الـ id والاسم ووقت التسجيل، ومفيش غير كده.
// الـ hash والـ fingerprint ونسخة التطبيق واسم المعتمد مش جزء من الرد أبداً.
// من spec 071: القائمة بقت بصفّين — المستنية (PENDING) والفعالة (ACTIVE) — وكود المطابقة للمستنية بس.

export const pendingDevicesQuery = pageQuery
  .extend({
    status: z.enum(['pending', 'active']),
    cursor: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .meta({ id: 'PendingDevicesQuery' });

/** المؤشر يحمل (created_at, id) مع الحالة معًا حتى لا تُفقد أجهزة اللحظة الواحدة ولا يُستخدم مؤشّر حالة في غيرها. */
export const pendingDevicesCursor = z.strictObject({
  v: z.literal(1),
  company: id,
  branch: id,
  status: z.enum(['pending', 'active']),
  at: timestamp.regex(/^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id,
});

export const pendingDevicesResponse = responseObject({
  items: z
    .array(
      responseObject({
        id,
        label: z.string(),
        created_at: timestamp,
        check_code: deviceCheckCode.nullable(),
        last_seen_at: timestamp.nullable(),
      }),
    )
    .max(100),
  next_cursor: z.string().max(512).nullable(),
}).meta({ id: 'PendingDevicesResponse' });

export type PendingDevicesQuery = z.infer<typeof pendingDevicesQuery>;
export type PendingDevicesCursor = z.infer<typeof pendingDevicesCursor>;
export type PendingDevicesResponse = z.infer<typeof pendingDevicesResponse>;
