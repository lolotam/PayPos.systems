'use client';
import { sessionTips, type SessionTips } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

export const sessionTipsPath =
  '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/tips';

export function sessionTipsKey(scope: SessionServiceScope, sessionId: string) {
  return [
    'session-tips',
    scope.companyId,
    scope.businessId,
    scope.branchId,
    scope.userId,
    sessionId,
  ] as const;
}

export async function readSessionTips(
  scope: SessionServiceScope,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionTips> {
  const result = await apiClient().GET(sessionTipsPath, {
    params: {
      header: { 'x-company-id': scope.companyId },
      path: { businessId: scope.businessId, branchId: scope.branchId, sessionId },
    },
    signal: signal ?? null,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return sessionTips.parse(result.data);
}

export function useSessionTips(scope: SessionServiceScope, sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: sessionTipsKey(scope, sessionId),
    enabled,
    retry: false,
    queryFn: ({ signal }) => readSessionTips(scope, sessionId, signal),
  });
}
