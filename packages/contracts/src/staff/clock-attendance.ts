import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { attendanceQrToken } from './attendance-qr.js';

const encoded = z
  .string()
  .min(1)
  .max(65536)
  .regex(/^[A-Za-z0-9_-]+$/);
export const attendanceLocation = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
});
export const clockChallengeInput = z
  .strictObject({
    token: attendanceQrToken,
    location: attendanceLocation.optional(),
  })
  .meta({ id: 'ClockChallengeInput' });
export const clockAttendanceInput = clockChallengeInput
  .extend({
    challenge_id: id,
    response: z.strictObject({
      id: encoded,
      rawId: encoded,
      type: z.literal('public-key'),
      authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
      clientExtensionResults: z.strictObject({}),
      response: z.strictObject({
        clientDataJSON: encoded,
        authenticatorData: encoded,
        signature: encoded,
        userHandle: encoded.optional(),
      }),
    }),
  })
  .meta({ id: 'ClockAttendanceInput' });
export const clockChallenge = z
  .strictObject({
    challenge_id: id,
    options: z.strictObject({
      challenge: encoded,
      rpId: z.string(),
      timeout: z.number().optional(),
      userVerification: z.literal('required'),
      allowCredentials: z
        .array(z.strictObject({ id: encoded, type: z.literal('public-key') }))
        .optional(),
    }),
  })
  .meta({ id: 'ClockChallenge' });
export const clockAttendanceResult = z
  .strictObject({
    session_id: id,
    operation: z.enum(['CLOCK_IN', 'CLOCK_OUT']),
    working_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accepted_at: timestamp,
    exceptions: z.array(z.enum(['NONE', 'OUT_OF_RANGE'])),
    late_minutes: z.number().int().nonnegative(),
    missed_session_id: id.nullable(),
  })
  .meta({ id: 'ClockAttendanceResult' });
export const clockAttendanceSchemas = [
  clockChallengeInput,
  clockAttendanceInput,
  clockChallenge,
  clockAttendanceResult,
];
export type ClockChallengeInput = z.infer<typeof clockChallengeInput>;
export type ClockAttendanceInput = z.infer<typeof clockAttendanceInput>;
export type ClockAttendanceResult = z.infer<typeof clockAttendanceResult>;
