'use client';
import { serviceSessionRecoveryPage } from '@pospay/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { ExpiredRecoveryProof } from '../model/session-attempt-journal';
import type { ExpiredAttemptView } from '../model/session-recording-result';
import { recoveryPanelFromRead } from '../model/session-recovery-state';
import type { SessionServiceScope } from './use-session-services';

export const RECOVERY_REVOKE_TIMEOUT_MS = 4000;
const recoveryPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery';
const confirmPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery/confirm';

// المفتاح في الهيدر فقط، ومش في رابط ولا في مفتاح الاستعلام. من غير lastSentAt الاستعلام متقفّل (#210).
async function readOwnRecordings(scope: SessionServiceScope, attempt: ExpiredAttemptView, cursor: string | undefined, signal: AbortSignal) {
  if (attempt.lastSentAt === undefined) throw new Error('SESSION_RECOVERY_NOT_SENT');
  const result = await apiClient().GET(recoveryPath, {
    params: { header: { 'x-company-id': scope.companyId, 'x-recovery-key': attempt.key },
      path: { businessId: scope.businessId, branchId: scope.branchId },
      query: { operation: attempt.operation, ...(cursor ? { cursor } : {}) } }, signal,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return serviceSessionRecoveryPage.parse(result.data);
}

export function useOwnRecordings(scope: SessionServiceScope, attempt: ExpiredAttemptView) {
  const enabled = attempt.lastSentAt !== undefined;
  const query = useInfiniteQuery({
    queryKey: ['own-recordings', scope.companyId, scope.businessId, scope.branchId, scope.userId, attempt.operation, attempt.createdAt, attempt.lastSentAt ?? null],
    enabled, retry: false, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => readOwnRecordings(scope, attempt, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const panel = recoveryPanelFromRead({ lastSentAt: attempt.lastSentAt, pages: query.data?.pages ?? [], error: query.error, morePageFailed: query.isFetchNextPageError });
  return { ...query, panel };
}

// نداء واحد بمهلة قصيرة ومن غير إعادة. الفشل بيتساب للمتصل بعد ما العلامة تكون اتمسحت.
export async function revokeOwnRecording(proof: ExpiredRecoveryProof): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOVERY_REVOKE_TIMEOUT_MS);
  try {
    const result = await apiClient().POST(confirmPath, {
      params: { header: { 'x-company-id': proof.scope.companyId, 'x-recovery-key': proof.key },
        path: { businessId: proof.scope.businessId, branchId: proof.scope.branchId } },
      body: { operation: proof.operation, outcome: proof.outcome }, signal: controller.signal,
    });
    if (result.error) throw { ...result.error, status: result.response.status };
  } finally { clearTimeout(timer); }
}

export function useRevokeOwnRecording() {
  return useMutation({ mutationKey: ['revoke-own-recording'], retry: false, networkMode: 'always', gcTime: 0, mutationFn: revokeOwnRecording });
}
