import createClient from 'openapi-fetch';
import { registerStaffPasskey } from '@pospay/auth/client';
import type { PersonalOtpRequestInput, PersonalOtpVerifyInput } from '@pospay/contracts';
import { apiOrigin } from '@/shared/api/origin';
import type { paths } from '@/shared/api/schema';

// لا middleware الجهاز هنا، حتى لو كان المتصفح قد استعمل كشكاً في وقت سابق.
const client = () =>
  createClient<paths>({ baseUrl: apiOrigin(), credentials: 'include', cache: 'no-store' });
export const personalCalls = {
  session: async () => (await client().GET('/v1/staff/personal-session')).data ?? null,
  binding: async () => {
    const result = await client().GET('/v1/staff/passkey');
    if (result.data === undefined) throw new Error('PASSKEY_STATUS_REFUSED');
    return result.data;
  },
  request: async (input: PersonalOtpRequestInput) =>
    (await client().POST('/v1/staff/personal-otp/request', { body: input })).data ?? null,
  verify: async (input: PersonalOtpVerifyInput) =>
    (await client().POST('/v1/staff/personal-otp/verify', { body: input })).data ?? null,
  signOut: async () => {
    const result = await client().POST('/v1/staff/personal-session/sign-out');
    if (!result.response.ok) throw new Error('PERSONAL_SIGN_OUT_REFUSED');
  },
  enrol: async () => {
    const generated = await client().POST('/v1/staff/passkey/options');
    if (generated.data === undefined) throw new Error('PASSKEY_REFUSED');
    const raw = await registerStaffPasskey(generated.data.options);
    const response = {
      id: raw.id,
      rawId: raw.rawId,
      type: raw.type,
      ...(raw.authenticatorAttachment === undefined
        ? {}
        : { authenticatorAttachment: raw.authenticatorAttachment }),
      clientExtensionResults:
        typeof raw.clientExtensionResults.credProps?.rk === 'boolean'
          ? { credProps: { rk: raw.clientExtensionResults.credProps.rk } }
          : {},
      response: {
        clientDataJSON: raw.response.clientDataJSON,
        attestationObject: raw.response.attestationObject,
        ...(raw.response.transports === undefined ? {} : { transports: raw.response.transports }),
      },
    };
    const verified = await client().POST('/v1/staff/passkey/verify', {
      body: { challenge_id: generated.data.challenge_id, response },
    });
    if (verified.data === undefined) throw new Error('PASSKEY_REFUSED');
    return verified.data;
  },
};
