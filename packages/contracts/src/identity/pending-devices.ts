import { z } from 'zod';

import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// الأجهزة اللي مستنية موافقة الـ manager في فرع واحد (spec 070): الـ id والاسم ووقت التسجيل، ومفيش غير كده.
// الـ hash والـ fingerprint ونسخة التطبيق واسم المعتمد مش جزء من الرد أبداً.

export const pendingDevicesQuery = z
  .object({ status: z.literal('pending') })
  .meta({ id: 'PendingDevicesQuery' });

export const pendingDevicesResponse = responseObject({
  items: z
    .array(
      responseObject({
        id,
        label: z.string(),
        created_at: timestamp,
      }),
    )
    .max(50),
}).meta({ id: 'PendingDevicesResponse' });

export type PendingDevicesQuery = z.infer<typeof pendingDevicesQuery>;
export type PendingDevicesResponse = z.infer<typeof pendingDevicesResponse>;
