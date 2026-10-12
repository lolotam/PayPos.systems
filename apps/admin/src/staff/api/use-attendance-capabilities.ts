'use client';
import { attendanceCapabilities, type AttendanceCapabilities } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { attendanceActionKey, attendanceActionParams } from './use-attendance-actions-read';
import type { AttendanceBoardScope } from './use-attendance-board';

export const noAttendanceWrites: AttendanceCapabilities = {
  correct: false,
  resolve: false,
  request_change: false,
  decide: false,
};
export function useAttendanceCapabilities(scope: AttendanceBoardScope) {
  const query = useQuery({
    queryKey: [...attendanceActionKey(scope), 'capabilities'],
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
    refetchOnMount: true,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-capabilities',
        { params: attendanceActionParams(scope), signal },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceCapabilities.parse(result.data);
    },
  });
  return {
    ...query,
    capabilities: query.isError ? noAttendanceWrites : (query.data ?? noAttendanceWrites),
  };
}
