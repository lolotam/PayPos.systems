import type { RegisterDeviceInput } from '@pospay/contracts';

import { call, type CallResult, type Failure } from '@/shared/api/call';
import { apiClient } from '@/shared/api/client';

import type { MeResult } from './screen-state';

export function registerDevice(input: RegisterDeviceInput): Promise<CallResult<Registered>> {
  return call(() =>
    apiClient().POST('/v1/devices/register', {
      body: { pairing_code: input.pairing_code, label: input.label },
    }),
  );
}

interface Registered {
  company_id: string;
  device_id: string;
  claim_secret: string;
}

export async function readDeviceMe(): Promise<MeResult> {
  const result = await call(() => apiClient().GET('/v1/devices/me'));
  if (result.ok) return { kind: 'ready', branchId: result.data.branch_id };
  if (isRejected(result.failure)) return { kind: 'rejected' };
  throw new Error('devices-me-unreachable');
}

function isRejected(failure: Failure): boolean {
  if (failure.kind === 'network') return false;
  const code = failure.envelope?.code;
  if (failure.status === 401 || failure.status === 403) return true;
  return code === 'UNAUTHENTICATED' || code === 'FORBIDDEN';
}
