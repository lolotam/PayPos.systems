import createClient from 'openapi-fetch';
import { assertStaffAttendance } from '@pospay/auth/client';
import type { ClockChallengeInput } from '@pospay/contracts';
import { apiOrigin } from '@/shared/api/origin';
import type { paths } from '@/shared/api/schema';
import { attendanceInstallationId } from '../model/installation-id';

const client = () =>
  createClient<paths>({ baseUrl: apiOrigin(), credentials: 'include', cache: 'no-store' });
export const attendanceCalls = {
  clock: async (scan: ClockChallengeInput, signal?: AbortSignal) => {
    const bodyScan = {
      installation_id: attendanceInstallationId(),
      token: scan.token,
      ...(scan.location === undefined ? {} : { location: scan.location }),
    };
    const generated = await client().POST('/v1/staff/attendance/challenge', {
      body: bodyScan,
      ...(signal === undefined ? {} : { signal }),
    });
    if (generated.data === undefined)
      throw new Error(generated.error?.code ?? 'ATTENDANCE_REFUSED');
    if (signal?.aborted || !navigator.onLine) throw new Error('ATTENDANCE_CANCELLED');
    const raw = await assertStaffAttendance(generated.data.options);
    if (signal?.aborted || !navigator.onLine) throw new Error('ATTENDANCE_CANCELLED');
    const body = {
      ...bodyScan,
      challenge_id: generated.data.challenge_id,
      response: {
        id: raw.id,
        rawId: raw.rawId,
        type: raw.type,
        clientExtensionResults: {},
        ...(raw.authenticatorAttachment === undefined
          ? {}
          : { authenticatorAttachment: raw.authenticatorAttachment }),
        response: {
          clientDataJSON: raw.response.clientDataJSON,
          authenticatorData: raw.response.authenticatorData,
          signature: raw.response.signature,
          ...(raw.response.userHandle === undefined ? {} : { userHandle: raw.response.userHandle }),
        },
      },
    };
    const result = await client().POST('/v1/staff/attendance/clock', {
      body,
      ...(signal === undefined ? {} : { signal }),
      params: { header: { 'Idempotency-Key': generated.data.challenge_id } },
    });
    if (result.data === undefined) throw new Error(result.error?.code ?? 'ATTENDANCE_REFUSED');
    return result.data;
  },
};

export function attendancePosition(): Promise<ClockChallengeInput['location']> {
  return new Promise((resolve) => {
    if (navigator.geolocation === undefined) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(undefined),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );
  });
}
