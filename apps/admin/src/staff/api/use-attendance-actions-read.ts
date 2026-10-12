'use client';
import {
  attendanceExceptionPage,
  attendanceCorrectionHistory,
  attendanceChangeRequestPage,
  type AttendanceExceptionPage,
  type AttendanceChangeRequestPage,
} from '@pospay/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { useAttendanceActionScope } from './use-attendance-action-scope';
import type { AttendanceBoardScope } from './use-attendance-board';

export function attendanceActionParams(scope: AttendanceBoardScope) {
  return {
    path: { businessId: scope.businessId, branchId: scope.branchId },
    header: { 'x-company-id': scope.companyId },
  };
}
export function attendanceActionKey(scope: AttendanceBoardScope) {
  return ['attendance-actions', scope.companyId, scope.businessId, scope.branchId, scope.userId];
}
export function useAttendanceExceptions(scope: AttendanceBoardScope, status: 'OPEN' | 'RESOLVED') {
  useAttendanceActionScope(scope, 'exceptions');
  return useInfiniteQuery({
    queryKey: [...attendanceActionKey(scope), 'exceptions', status],
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AttendanceExceptionPage) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-exceptions',
        {
          params: {
            ...attendanceActionParams(scope),
            query: { status, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceExceptionPage.parse(result.data);
    },
  });
}
export function useAttendanceHistory(scope: AttendanceBoardScope, sessionId: string) {
  useAttendanceActionScope(scope, 'history');
  return useQuery({
    queryKey: [...attendanceActionKey(scope), 'history', sessionId],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-sessions/{sessionId}/corrections',
        {
          params: {
            ...attendanceActionParams(scope),
            path: { ...attendanceActionParams(scope).path, sessionId },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceCorrectionHistory.parse(result.data);
    },
  });
}
export function useAttendanceRequests(
  scope: AttendanceBoardScope,
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
) {
  useAttendanceActionScope(scope, 'requests');
  return useInfiniteQuery({
    queryKey: [...attendanceActionKey(scope), 'requests', status],
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AttendanceChangeRequestPage) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/attendance-change-requests',
        {
          params: {
            ...attendanceActionParams(scope),
            query: {
              branch_id: scope.branchId,
              limit: 50,
              ...(status ? { status } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceChangeRequestPage.parse(result.data);
    },
  });
}
