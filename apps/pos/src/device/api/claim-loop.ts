import { call, type Failure } from '@/shared/api/call';
import { apiClient } from '@/shared/api/client';

import { deviceDb, CURRENT_DEVICE, type DeviceCredentialRow } from '../model/device-db';
import { enqueueWrite } from '../model/write-queue';

const PENDING_MS = 15_000;
const LIMITED_MS = 60_000;

export type ClaimTick = 'approved' | 'refused' | 'limited' | 'retry';

let chain: Promise<void> = Promise.resolve();

// المطالبة واحدة ورا التانية: السيرفر بيمسح سر المطالبة لما يصدر التوكن،
// وطلب تاني متزامن كان هيتقرأ كرفض ويمسح التوكن اللي لسه اتكتب.
export function claimQueued(): Promise<ClaimTick> {
  const next = chain.then(claimLocked, claimLocked);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function claimLocked(): Promise<ClaimTick> {
  return enqueueWrite(runClaim);
}

export function watchClaim(onApproved: () => void, onRefused: () => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = async (): Promise<void> => {
    if (stopped) return;
    const tick = await claimQueued().catch(() => 'retry' as const);
    if (stopped) return;
    if (tick === 'approved') {
      onApproved();
      return;
    }
    if (tick === 'refused') {
      onRefused();
      return;
    }
    timer = setTimeout(() => {
      void step();
    }, tick === 'limited' ? LIMITED_MS : PENDING_MS);
  };
  void step();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

async function runClaim(): Promise<ClaimTick> {
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return 'approved';
  if (!row?.claim_secret) return 'retry';
  const result = await postClaim({ ...row, claim_secret: row.claim_secret });
  if (!result.ok) return settleFailure(result.failure);
  await writeToken(row, result.data.device_token);
  return 'approved';
}

function postClaim(row: DeviceCredentialRow & { claim_secret: string }) {
  return call(() =>
    apiClient().POST('/v1/devices/claim', {
      body: {
        company_id: row.company_id,
        device_id: row.device_id,
        claim_secret: row.claim_secret,
      },
    }),
  );
}

async function settleFailure(failure: Failure): Promise<ClaimTick> {
  const kind = classify(failure);
  if (kind !== 'refused') return kind;
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return 'approved';
  await deviceDb.credentials.delete(CURRENT_DEVICE);
  return 'refused';
}

function classify(failure: Failure): 'limited' | 'refused' | 'retry' {
  if (failure.kind === 'network') return 'retry';
  const code = failure.envelope?.code;
  if (code === 'TOO_MANY_REQUESTS' || failure.status === 429) return 'limited';
  if (code === 'UNAUTHENTICATED' || failure.status === 401 || failure.status === 403) {
    return 'refused';
  }
  return 'retry';
}

async function writeToken(row: DeviceCredentialRow, deviceToken: string): Promise<void> {
  await deviceDb.credentials.put({
    id: CURRENT_DEVICE,
    company_id: row.company_id,
    device_id: row.device_id,
    claim_secret: null,
    device_token: deviceToken,
  });
}
