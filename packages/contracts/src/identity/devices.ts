import { z } from 'zod';

import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

// أجهزة الفروع (ADR-0003 §4 path B، plan T9b-2). الأسرار بتتبعت للجهاز مرة واحدة وعمرها ما بترجع تاني.

// الكود اللي الـ manager بيطلّعه — 8 حروف من غير الحروف اللي بتتلخبط، صالح 10 دقايق ومرة واحدة.
export const pairingCode = z
  .object({ code: z.string().regex(/^[A-Z0-9]{8}$/), expires_at: timestamp })
  .meta({ id: 'PairingCode' });

export const registerDeviceInput = z
  .object({
    pairing_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{8}$/),
    label: z.string().trim().min(1).max(100),
    device_fingerprint: z.string().trim().min(1).max(255).optional(),
    app_version: z.string().trim().min(1).max(50).optional(),
  })
  .strict()
  .meta({ id: 'RegisterDeviceInput' });

// الرد على التسجيل: الجهاز بيحفظ السر ده عشان ياخد التوكن بعد موافقة الـ manager.
export const deviceRegistration = z
  .object({ company_id: id, device_id: id, claim_secret: z.string() })
  .meta({ id: 'DeviceRegistration' });

export const claimDeviceInput = z
  .object({ company_id: id, device_id: id, claim_secret: z.string().min(1).max(100) })
  .strict()
  .meta({ id: 'ClaimDeviceInput' });

export const deviceToken = z.object({ device_token: z.string() }).meta({ id: 'DeviceToken' });

export type PairingCode = z.infer<typeof pairingCode>;
export type RegisterDeviceInput = z.output<typeof registerDeviceInput>;
export type DeviceRegistration = z.infer<typeof deviceRegistration>;
export type ClaimDeviceInput = z.infer<typeof claimDeviceInput>;
export type DeviceToken = z.infer<typeof deviceToken>;
