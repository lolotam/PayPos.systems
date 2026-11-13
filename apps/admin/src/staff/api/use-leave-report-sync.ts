'use client';
import { leaveHistoryPage, type LeaveHistoryQuery } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { LeaveReportScope } from '../model/leave-report-view';

/**
 * طلب القراءة السريعة: نطاق الشاشة، استعلام الفترة، الموظف، رقم التشغيل، ومؤشر الصفحة.
 */
export type LeaveReportSyncRequest = {
  scope: LeaveReportScope;
  query: LeaveHistoryQuery;
  employeeId: string;
  run: number;
  cursor: string | undefined;
};

/**
 * القراءة السريعة لكل تشغيل: هي اللي بتقرر إن الاستعلام تقيل ولا لا، فمفيش إعادة تلقائية ولا تجديد.
 */
export function useLeaveReportSync({
  scope,
  query,
  employeeId,
  run,
  cursor,
}: LeaveReportSyncRequest) {
  return useQuery({
    queryKey: [
      'leave-report',
      scope.companyId,
      scope.businessId,
      scope.userId,
      'sync',
      run,
      query,
      employeeId,
      cursor,
    ],
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/leave-history', {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId },
          query: {
            from: query.from,
            to: query.to,
            ...(query['types[]'].length > 0 ? { 'types[]': query['types[]'] } : {}),
            ...(query['statuses[]'].length > 0 ? { 'statuses[]': query['statuses[]'] } : {}),
            ...(query.branch_id ? { branch_id: query.branch_id } : {}),
            ...(employeeId ? { employee_id: employeeId } : {}),
            ...(cursor ? { cursor } : {}),
            limit: query.limit,
          },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryPage.parse(result.data);
    },
  });
}
