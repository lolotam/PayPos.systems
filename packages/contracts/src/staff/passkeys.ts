import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { staffSchedule, scheduleWeekQuery } from './schedules.js';
import { staffOtpRequestInput, staffOtpVerifyInput } from '../identity/staff-otp.js';

export const personalWorkspace = z.strictObject({ company_id: id, business_id: id });
export const personalOtpRequestInput = staffOtpRequestInput
  .extend(personalWorkspace.shape)
  .meta({ id: 'PersonalOtpRequestInput' });
export const personalOtpVerifyInput = staffOtpVerifyInput
  .extend(personalWorkspace.shape)
  .meta({ id: 'PersonalOtpVerifyInput' });
export const personalSessionContext = z
  .strictObject({
    ...personalWorkspace.shape,
    user_id: id,
    employee_id: id,
    expires_at: timestamp,
  })
  .meta({ id: 'PersonalSessionContext' });

const base64url = z
  .string()
  .min(1)
  .max(65536)
  .regex(/^[A-Za-z0-9_-]+$/);
const transport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
export const registrationResponse = z.strictObject({
  id: base64url,
  rawId: base64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.strictObject({
    credProps: z.strictObject({ rk: z.boolean() }).optional(),
  }),
  response: z.strictObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(transport).max(7).optional(),
    authenticatorData: base64url.optional(),
    publicKey: base64url.optional(),
    publicKeyAlgorithm: z.number().int().optional(),
  }),
});
export const passkeyVerifyInput = z
  .strictObject({
    installation_id: z.uuid({ version: 'v4' }).toLowerCase().optional(),
    challenge_id: id,
    response: registrationResponse,
  })
  .meta({ id: 'PasskeyVerifyInput' });
export const passkeyOptionsInput = z
  .strictObject({
    installation_id: z.uuid({ version: 'v4' }).toLowerCase().optional(),
  })
  .default({})
  .meta({ id: 'PasskeyOptionsInput' });
export const passkeyBindingStatus = z
  .strictObject({
    bound: z.boolean(),
    binding_id: id.nullable(),
    revision: z.number().int().positive().nullable(),
    bound_at: timestamp.nullable(),
  })
  .meta({ id: 'PasskeyBindingStatus' });
export const passkeyRegistrationOptions = z
  .strictObject({
    challenge_id: id,
    options: z.strictObject({
      challenge: base64url,
      rp: z.strictObject({ id: z.string(), name: z.literal('PosPay') }),
      user: z.strictObject({ id: base64url, name: z.string(), displayName: z.string() }),
      pubKeyCredParams: z.array(
        z.strictObject({ type: z.literal('public-key'), alg: z.number().int() }),
      ),
      hints: z
        .array(z.enum(['security-key', 'client-device', 'hybrid']))
        .max(3)
        .optional(),
      timeout: z.number().optional(),
      attestation: z.literal('none'),
      excludeCredentials: z
        .array(
          z.strictObject({
            id: base64url,
            type: z.literal('public-key'),
            transports: z.array(transport).optional(),
          }),
        )
        .optional(),
      authenticatorSelection: z.strictObject({
        authenticatorAttachment: z.literal('platform'),
        residentKey: z.literal('required'),
        requireResidentKey: z.boolean().optional(),
        userVerification: z.literal('required'),
      }),
      extensions: z.strictObject({ credProps: z.boolean().optional() }).optional(),
    }),
  })
  .meta({ id: 'PasskeyRegistrationOptions' });

export const personalScheduleQuery = scheduleWeekQuery.extend({ branch_id: id });
export const personalSchedule = z
  .strictObject({ schedule: staffSchedule.nullable() })
  .meta({ id: 'PersonalSchedule' });

export const passkeySchemas = [
  passkeyOptionsInput,
  personalOtpRequestInput,
  personalOtpVerifyInput,
  personalSessionContext,
  personalSchedule,
  passkeyVerifyInput,
  passkeyBindingStatus,
  passkeyRegistrationOptions,
];
export type PersonalOtpRequestInput = z.infer<typeof personalOtpRequestInput>;
export type PersonalOtpVerifyInput = z.infer<typeof personalOtpVerifyInput>;
export type PersonalSessionContext = z.infer<typeof personalSessionContext>;
export type PasskeyVerifyInput = z.infer<typeof passkeyVerifyInput>;
export type PasskeyOptionsInput = z.infer<typeof passkeyOptionsInput>;
export type PasskeyBindingStatus = z.infer<typeof passkeyBindingStatus>;
export type PasskeyRegistrationOptions = z.infer<typeof passkeyRegistrationOptions>;
