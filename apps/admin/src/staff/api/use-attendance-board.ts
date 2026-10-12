'use client';
import {
  attendanceBoard,
  attendanceDeviceRefusalPage,
  type AttendanceDeviceRefusalPage,
} from '@pospay/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
import { boardAccessLost } from '../model/attendance-board-display';

export type AttendanceBoardScope = {
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
};
export function useAttendanceBoard(scope: AttendanceBoardScope, date?: string) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  const key = ['attendance-board', companyId, businessId, branchId, userId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, branchId } };
  const polling = {
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always' as const,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  };
  const board = useQuery({
    ...polling,
    queryKey: [...key, 'day', date],
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-board',
        {
          params: { ...params, query: date ? { date } : {} },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceBoard.parse(result.data);
    },
  });
  const refusals = useInfiniteQuery({
    ...polling,
    queryKey: [...key, 'refusals'],
    enabled: Boolean(board.data) && !boardAccessLost(board.error),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AttendanceDeviceRefusalPage) => page.next_cursor ?? undefined,
    queryFn: async ({ signal, pageParam }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/branches/{branchId}/attendance-board/refusals',
        {
          params: { ...params, query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceDeviceRefusalPage.parse(result.data);
    },
  });
  useEffect(
    () => () => {
      client.removeQueries({
        queryKey: ['attendance-board', companyId, businessId, branchId, userId],
      });
    },
    [client, companyId, businessId, branchId, userId],
  );
  return { board, refusals };
}
