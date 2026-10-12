'use client';
import { attendanceMonthlyReportQuery } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import { downloadAttendanceCsv } from './download-attendance-csv';
import type { AttendanceReportScope } from './use-attendance-report';

async function csvError(error: unknown, status: number) {
  let envelope = error;
  const blob = error as { text?: () => Promise<string> } | null;
  if (typeof blob?.text === 'function') {
    try {
      envelope = JSON.parse(await blob.text()) as unknown;
    } catch {
      envelope = null;
    }
  }
  return {
    ...(typeof envelope === 'object' && envelope !== null ? envelope : {}),
    status,
  };
}

export function useAttendanceReportCsv(
  scope: AttendanceReportScope,
  month: string,
  branchName: string,
) {
  const client = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const downloads = useRef(new Set<() => void>());
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
      if (result.error) throw await csvError(result.error, result.response.status);
      if (!result.data) throw new Error('Empty CSV response');
      downloads.current.add(
        downloadAttendanceCsv(result.data, branchId === 'all' ? 'all' : branchName, month),
      );
    },
  });
  useEffect(() => {
    const releases = downloads.current;
    return () => {
      controller.current?.abort();
      for (const release of releases) release();
      releases.clear();
      const cache = client.getMutationCache();
      const key = ['attendance-report-csv', companyId, businessId, userId, branchId, month];
      for (const mutation of cache.findAll({ mutationKey: key, exact: true }))
        cache.remove(mutation);
    };
  }, [client, companyId, businessId, userId, branchId, month]);
  return download;
}
