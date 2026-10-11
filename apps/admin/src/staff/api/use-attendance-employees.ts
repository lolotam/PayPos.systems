'use client';
import { attendanceEmployeePage, type AttendanceEmployeePage } from '@pospay/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useAttendanceActionScope } from './use-attendance-action-scope';
import { attendanceActionKey, attendanceActionParams } from './use-attendance-actions-read';
import type { AttendanceBoardScope } from './use-attendance-board';
export function useAttendanceEmployees(scope: AttendanceBoardScope, search = '') {
  useAttendanceActionScope(scope, 'employees');
  const term = search.trim();
  return useInfiniteQuery({
    queryKey: [...attendanceActionKey(scope), 'employees', term],
    retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AttendanceEmployeePage) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-employees',
        {
          params: {
            ...attendanceActionParams(scope),
            query: { limit: 50, search: term, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceEmployeePage.parse(result.data);
    },
  });
}
