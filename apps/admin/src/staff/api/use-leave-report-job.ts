'use client';
import {
  leaveHistoryReportAccepted,
  leaveHistoryReportStatus,
  type LeaveHistoryReportStatus,
} from '@pospay/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { LeaveReportBody, LeaveReportScope } from '../model/leave-report-view';

const REPORT_POLL_INTERVAL_MS = 3000;

/**
 * تشغيل التقرير الثقيل: الطلب نفسه منفصل عن قراءة النتيجة، وعليه يبقى في الاستدعاء مش في الـ hook.
 */
export function useLeaveReportJob(
  scope: LeaveReportScope,
  reportId: string | undefined,
  cursor: string | undefined,
  limit: number,
) {
  const request = useMutation({
    retry: false,
    mutationFn: async (body: LeaveReportBody) => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/leave-history/reports', {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId },
        },
        body,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryReportAccepted.parse(result.data);
    },
  });
  const result = useQuery<LeaveHistoryReportStatus>({
    queryKey: [
      'leave-report',
      scope.companyId,
      scope.businessId,
      scope.userId,
      'job',
      reportId,
      cursor,
    ],
    enabled: reportId !== undefined,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[5] === reportId ? previous : undefined,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? REPORT_POLL_INTERVAL_MS : false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/leave-history/reports/{reportId}',
        {
          params: {
            header: { 'x-company-id': scope.companyId },
            path: { businessId: scope.businessId, reportId: reportId ?? '' },
            query: { ...(cursor ? { cursor } : {}), limit },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryReportStatus.parse(result.data);
    },
  });
  return { request, result };
}
