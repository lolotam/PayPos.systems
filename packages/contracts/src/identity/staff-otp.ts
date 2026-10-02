import { z } from 'zod';
import { id } from '../scalars/id.js';

export const canonicalStaffPhone = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const staffOtpRequestInput = z
  .object({
    phone: canonicalStaffPhone,
    locale: z.enum(['ar', 'en']),
  })
  .strict()
  .meta({ id: 'StaffOtpRequestInput' });

export const staffOtpVerifyInput = z
  .object({
    challenge_id: id,
    code: z.string().regex(/^\d{6}$/),
  })
  .strict()
  .meta({ id: 'StaffOtpVerifyInput' });

export const staffOtpAcknowledgement = z
  .object({
    status: z.literal('ACCEPTED'),
    challenge_id: id,
    expires_in: z.literal(300),
    retry_after: z.literal(60),
    recovery: z.literal('ASK_MANAGER'),
  })
  .strict()
  .meta({ id: 'StaffOtpAcknowledgement' });

export const staffSessionContext = z
  .object({
    user_id: id,
    company_id: id,
    business_id: id,
    branch_id: id,
    device_id: id,
    expires_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'StaffSessionContext' });

export const staffOtpJob = z
  .object({
    challenge_id: id,
    attempt_id: id,
  })
  .strict();

export type StaffOtpRequestInput = z.infer<typeof staffOtpRequestInput>;
export type StaffOtpVerifyInput = z.infer<typeof staffOtpVerifyInput>;
export type StaffOtpAcknowledgement = z.infer<typeof staffOtpAcknowledgement>;
export type StaffSessionContext = z.infer<typeof staffSessionContext>;

export const staffPinInput = z
  .object({
    phone: canonicalStaffPhone,
    pin: z.string().regex(/^\d{4}$/),
  })
  .strict()
  .meta({ id: 'StaffPinInput' });
export const staffPinResetInput = z
  .object({
    user_id: id,
    pin: z.string().regex(/^\d{4}$/),
  })
  .strict()
  .meta({ id: 'StaffPinResetInput' });
export type StaffPinInput = z.infer<typeof staffPinInput>;
export type StaffPinResetInput = z.infer<typeof staffPinResetInput>;
