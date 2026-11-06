import createClient from 'openapi-fetch';
import type { RequestLeaveInput } from '@pospay/contracts';
import { staffApiClient } from '@/shared/api/client';
import { nativeStaffFetch } from '@/shared/api/native-staff-fetch';
import { apiOrigin } from '@/shared/api/origin';
import type { paths } from '@/shared/api/schema';
import { usesNativeStaffTransport } from '@/shared/platform/native-shell';
import type { LeaveContext } from '../model/context';

// الجلسة الشخصية لا تستعير توكن جهاز قديم موجود في المتصفح.
function client(mode: LeaveContext['mode']) {
  return mode === 'reception'
    ? staffApiClient()
    : createClient<paths>({
        baseUrl: apiOrigin(),
        credentials: 'include',
        cache: 'no-store',
        ...(usesNativeStaffTransport() ? { fetch: nativeStaffFetch } : {}),
      });
}
function value<T>(result: { data?: T; error?: { code: string } }): T {
  if (result.data === undefined) throw new Error(result.error?.code ?? 'NOT_READY');
  return result.data;
}
export const leaveCalls = {
  branches: async (signal: AbortSignal) =>
    value(await client('personal').GET('/v1/staff/me/branches', { signal, cache: 'no-store' })),
  list: async (
    mode: LeaveContext['mode'],
    branch: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) =>
    value(
      await client(mode).GET('/v1/staff/me/leave-requests', {
        signal,
        cache: 'no-store',
        params: {
          header: { Origin: window.location.origin },
          query: {
            ...(mode === 'personal' ? { branch_id: branch } : {}),
            ...(cursor ? { cursor } : {}),
            limit: 20,
          },
        },
      }),
    ),
  create: async (
    mode: LeaveContext['mode'],
    branch: string,
    input: RequestLeaveInput,
    key: string,
    signal: AbortSignal,
  ) =>
    value(
      await client(mode).POST('/v1/staff/me/leave-requests', {
        signal,
        cache: 'no-store',
        body: leaveBody(input),
        params: {
          query: mode === 'personal' ? { branch_id: branch } : {},
          header: { Origin: window.location.origin, 'Idempotency-Key': key },
        },
      }),
    ),
  cancel: async (
    mode: LeaveContext['mode'],
    branch: string,
    id: string,
    revision: number,
    key: string,
    signal: AbortSignal,
  ) =>
    value(
      await client(mode).POST('/v1/staff/me/leave-requests/{leaveId}/cancel', {
        signal,
        cache: 'no-store',
        body: { expected_revision: revision },
        params: {
          path: { leaveId: id },
          query: mode === 'personal' ? { branch_id: branch } : {},
          header: { Origin: window.location.origin, 'Idempotency-Key': key },
        },
      }),
    ),
};

function leaveBody(input: RequestLeaveInput) {
  const { note, ...body } = input;
  return { ...body, ...(note === undefined ? {} : { note }) };
}
