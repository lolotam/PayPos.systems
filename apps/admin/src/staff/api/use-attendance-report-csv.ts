'use client';
import { attendanceMonthlyReportQuery } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import { downloadAttendanceCsv } from './download-attendance-csv';
import type { AttendanceReportScope } from './use-attendance-report';

export function useAttendanceReportCsv(scope: AttendanceReportScope, month: string) {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const { companyId, businessId, branchId, userId } = scope;
  const download = useMutation({
    mutationKey: ['attendance-report-csv', companyId, businessId, userId, branchId, month],
    gcTime: 0,
    retry: false,
    mutationFn: async () => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const params = {
        header: { 'x-company-id': companyId },
        query: attendanceMonthlyReportQuery.parse({ month }),
      };
      const options = { parseAs: 'blob' as const, signal: request.signal };
      const result =
        branchId === 'all'
          ? await apiClient().GET('/v1/businesses/{businessId}/attendance-report.csv', {
              ...options,
              params: { ...params, path: { businessId } },
            })
          : await apiClient().GET(
              '/v1/businesses/{businessId}/branches/{branchId}/attendance-report.csv',
              {
                ...options,
                params: { ...params, path: { businessId, branchId } },
              },
            );
      if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (result.error) throw { ...result.error, status: result.response.status };
      if (!result.data) throw new Error('Empty CSV response');
      downloadAttendanceCsv(result.data, branchId, month);
    },
  });
  useEffect(
    () => () => {
      controller.current?.abort();
      const cache = client.getMutationCache();
      const key = ['attendance-report-csv', companyId, businessId, userId, branchId, month];
      for (const mutation of cache.findAll({ mutationKey: key, exact: true }))
        cache.remove(mutation);
    },
    [client, companyId, businessId, userId, branchId, month],
  );
  return download;
}
