'use client';
import { employeePage, type EmployeePage } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useAttendanceActionScope } from './use-attendance-action-scope';
import { attendanceActionKey, attendanceActionParams } from './use-attendance-actions-read';
import type { AttendanceBoardScope } from './use-attendance-board';
export function useAttendanceEmployees(scope: AttendanceBoardScope) {
  useAttendanceActionScope(scope, 'employees');
  return useInfiniteQuery({
    queryKey: [...attendanceActionKey(scope), 'employees'],
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: EmployeePage) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/employees', {
        params: {
          ...attendanceActionParams(scope),
          query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeePage.parse(result.data);
    },
  });
}
