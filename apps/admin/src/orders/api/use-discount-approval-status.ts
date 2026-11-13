'use client';
import { requesterDiscountProposalList, type RequesterDiscountProposalList } from '@pospay/contracts';
import { useQueries, type Query } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const statusPath = '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals';
type Item = RequesterDiscountProposalList['items'][number];
export type DiscountApprovalStatus = { data?: Item[]; error: unknown; refetch: () => void };

function statusInterval(items: Item[] | undefined): number | false {
  if (!items || items.some((item) => item.status === 'PENDING')) return 5000;
  return items.some((item) => item.status === 'APPROVED') ? 30000 : false;
}

export function useDiscountApprovalStatuses(scope: SessionServiceScope, requestIds: string[]): Record<string, DiscountApprovalStatus> {
  const queries = useQueries({ queries: requestIds.map((requestId) => ({
    queryKey: ['discount-approval-status', scope.companyId, scope.businessId, scope.branchId, scope.userId, requestId],
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query: Query<RequesterDiscountProposalList>) => statusInterval(query.state.data?.items),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const result = await apiClient().GET(statusPath, {
        params: { header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId }, query: { request_id: requestId } }, signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return requesterDiscountProposalList.parse(result.data);
    },
  })) });
  return Object.fromEntries(requestIds.map((requestId, index) => {
    const query = queries[index];
    return [requestId, { ...(query?.data ? { data: query.data.items } : {}), error: query?.error ?? null,
      refetch: () => { void query?.refetch(); } }];
  }));
}
