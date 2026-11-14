import {
  deviceDiscountProposalList,
  type DeviceApproveDiscountProposalsInput,
  type DeviceDiscountProposalList,
  type DeviceRejectDiscountProposalsInput,
} from '@pospay/contracts';

import { call, type CallResult } from '@/shared/api/call';
import { apiClient } from '@/shared/api/client';

export type DeviceProposal = DeviceDiscountProposalList['items'][number];
export type DeviceDecisionInput = Pick<
  DeviceApproveDiscountProposalsInput,
  'proposal_ids' | 'terms_hashes' | 'phone' | 'pin'
> & { reason?: NonNullable<DeviceRejectDiscountProposalsInput['reason']> };

export class DeviceDiscountReadError extends Error {
  constructor(readonly rejected: boolean) {
    super('device-discount-read-failed');
  }
}

export async function readDeviceDiscountProposals(
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<DeviceDiscountProposalList> {
  const result = await call(() =>
    apiClient().GET('/v1/devices/me/discount-proposals', {
      params: { query: { limit: 50, ...(cursor === undefined ? {} : { cursor }) } },
      signal,
      cache: 'no-store',
    }),
  );
  if (!result.ok) {
    const code = result.failure.kind === 'http' ? result.failure.envelope?.code : undefined;
    throw new DeviceDiscountReadError(code === 'UNAUTHENTICATED' || code === 'FORBIDDEN');
  }
  return deviceDiscountProposalList.parse(result.data);
}

export function decideDeviceDiscountProposal(
  decision: 'approve' | 'reject',
  body: DeviceDecisionInput,
): Promise<CallResult<unknown>> {
  const path = `/v1/devices/me/discount-proposals/${decision}` as const;
  return call(() => apiClient().POST(path, { body, cache: 'no-store' }));
}
