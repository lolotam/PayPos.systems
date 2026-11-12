'use client';
import { leaveHistoryPage, type LeaveHistoryQuery } from '@pospay/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { leaveScopeKey } from './leave-query-scope';

export function useLeaveHistory(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  query: LeaveHistoryQuery | undefined,
  cursor?: string,
) {
  const key = leaveScopeKey(companyId, businessId, userId, employeeId);
  return useQuery({
    queryKey: [...key, 'history', query, cursor],
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      if (!query) throw new Error('Leave history query is required');
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-history',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
            query: {
              from: query.from,
              to: query.to,
              ...(query['types[]'].length > 0 ? { 'types[]': query['types[]'] } : {}),
              ...(query['statuses[]'].length > 0 ? { 'statuses[]': query['statuses[]'] } : {}),
              limit: query.limit,
              ...(query.branch_id ? { branch_id: query.branch_id } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryPage.parse(result.data);
    },
  });
}
