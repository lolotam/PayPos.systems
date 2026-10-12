'use client';
import { attendanceChangeRequestPage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { attendanceActionKey, attendanceActionParams } from './use-attendance-actions-read';
import { useAttendanceActionScope } from './use-attendance-action-scope';
import type { AttendanceBoardScope } from './use-attendance-board';

export function useAttendanceRequestsAccess(scope: AttendanceBoardScope) {
  useAttendanceActionScope(scope, 'requests-access');
  const query = useQuery({
    queryKey: [...attendanceActionKey(scope), 'requests-access'],
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/attendance-change-requests',
        {
          params: {
            ...attendanceActionParams(scope),
            query: { limit: 1, branch_id: scope.branchId },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceChangeRequestPage.parse(result.data);
    },
  });
  return {
    ...query,
    canDecideAny: !query.isError && query.data?.can_decide_any === true,
    canRequest: !query.isError && query.data?.can_request === true,
  };
}
