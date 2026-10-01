import { call, type Failure } from '@/shared/api/call';
import { apiClient } from '@/shared/api/client';

import { applyIfRegistration, type ClaimSnapshot } from '../model/credentials';
import { deviceDb, CURRENT_DEVICE } from '../model/device-db';

const PENDING_MS = 15_000;
const LIMITED_MS = 60_000;

export type ClaimTick = 'approved' | 'refused' | 'limited' | 'retry';

// طلب المطالبة اللي واقف بيتلغي بعد المدة دي ويتحسب 'retry'، عشان ما يحجزش القفل على تسجيل جديد.
const CLAIM_TIMEOUT_MS = 20_000;

// المطالبة لنفس الجهاز واحدة ورا التانية حتى بين التابات (Web Locks): السيرفر بيمسح سر المطالبة لما يصدر
// التوكن، فطلب تاني متزامن بيترد عليه UNAUTHENTICATED، ولو رده وصل الأول كان هيمسح التسجيل والتوكن معاه.
// القفل باسم الجهاز، فتسجيل جديد بعد «البدء من جديد» ما يستناش طلب قديم. من غير Web Locks مفيش مطالبة خالص —
// bootDevice بيعرض شاشة «المتصفح غير مدعوم» قبل ما نوصل هنا.
function withClaimLock<T>(deviceId: string, run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) return Promise.reject(new Error('Web Locks unavailable'));
  return locks.request(`pospay-claim:${deviceId}`, run);
}

export async function claimQueued(): Promise<ClaimTick> {
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return 'approved';
  if (!row?.claim_secret) return 'retry';
  const deviceId = row.device_id;
  return withClaimLock(deviceId, () => runClaim(deviceId));
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
    timer = setTimeout(
      () => {
        void step();
      },
      tick === 'limited' ? LIMITED_MS : PENDING_MS,
    );
  };
  void step();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

async function runClaim(deviceId: string): Promise<ClaimTick> {
  const row = await deviceDb.credentials.get(CURRENT_DEVICE);
  if (row?.device_token) return 'approved';
  if (!row?.claim_secret || row.device_id !== deviceId) return 'retry';
  const claim = { device_id: row.device_id, claim_secret: row.claim_secret };
  const result = await postClaim({ ...claim, company_id: row.company_id });
  if (!result.ok) return settleFailure(claim, result.failure);
  const token = result.data.device_token;
  const written = await applyIfRegistration(claim, (current) => writeToken(current, token));
  return written ? 'approved' : 'retry';
}

function postClaim(row: ClaimSnapshot & { company_id: string }) {
  return call(() =>
    apiClient().POST('/v1/devices/claim', {
      body: {
        company_id: row.company_id,
        device_id: row.device_id,
        claim_secret: row.claim_secret,
      },
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    }),
  );
}

async function settleFailure(claim: ClaimSnapshot, failure: Failure): Promise<ClaimTick> {
  const kind = classify(failure);
  if (kind !== 'refused') return kind;
  const cleared = await applyIfRegistration(claim, () =>
    deviceDb.credentials.delete(CURRENT_DEVICE),
  );
  return cleared ? 'refused' : 'retry';
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

async function writeToken(
  row: { company_id: string; device_id: string },
  deviceToken: string,
): Promise<void> {
  await deviceDb.credentials.put({
    id: CURRENT_DEVICE,
    company_id: row.company_id,
    device_id: row.device_id,
    claim_secret: null,
    device_token: deviceToken,
  });
}
