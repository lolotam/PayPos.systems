'use client';
import { leavePage, type LeaveInboxQuery } from '@pospay/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
import type { LeaveDecisionScope } from './use-leave-decisions';
export function useLeaveInbox(scope: LeaveDecisionScope, query: LeaveInboxQuery) {
  const client = useQueryClient();
  const key = ['leave', scope.companyId, scope.businessId, scope.userId, 'inbox'];
  const result = useQuery({
    queryKey: [...key, query],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const { branch_id, from, to, cursor, limit } = query;
      const response = await apiClient().GET('/v1/businesses/{businessId}/leave-requests', {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId },
          query: {
            limit,
            ...(branch_id ? { branch_id } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
        signal,
      });
      if (response.error) throw { ...response.error, status: response.response.status };
      return leavePage.parse(response.data);
    },
  });
  useEffect(
    () => () => {
      client.removeQueries({
        queryKey: ['leave', scope.companyId, scope.businessId, scope.userId, 'inbox'],
      });
    },
    [client, scope.companyId, scope.businessId, scope.userId],
  );
  useEffect(() => {
    const status = (result.error as { status?: number } | null)?.status;
    if (result.isError && (status === 403 || status === 404))
      client.removeQueries({
        queryKey: ['leave', scope.companyId, scope.businessId, scope.userId, 'inbox'],
      });
  }, [client, scope.companyId, scope.businessId, scope.userId, result.isError, result.error]);
  return result;
}
