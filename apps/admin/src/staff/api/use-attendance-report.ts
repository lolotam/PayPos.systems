'use client';
import { attendanceMonthlyReport, attendanceMonthlyReportQuery } from '@pospay/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

export type AttendanceReportScope = {
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
};
export function useAttendanceReport(scope: AttendanceReportScope, month: string) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  const report = useQuery({
    queryKey: ['attendance-report', companyId, businessId, userId, branchId, month],
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      const query = attendanceMonthlyReportQuery.parse({ month });
      const params = { header: { 'x-company-id': companyId }, query };
      const result =
        branchId === 'all'
          ? await apiClient().GET('/v1/businesses/{businessId}/attendance-report', {
              params: { ...params, path: { businessId } },
              signal,
            })
          : await apiClient().GET(
              '/v1/businesses/{businessId}/branches/{branchId}/attendance-report',
              {
                params: { ...params, path: { businessId, branchId } },
                signal,
              },
            );
      if (result.error) throw { ...result.error, status: result.response.status };
      return attendanceMonthlyReport.parse(result.data);
    },
  });
  useEffect(
    () => () => {
      client.removeQueries({ queryKey: ['attendance-report', companyId, businessId, userId] });
    },
    [client, companyId, businessId, userId],
  );
  return report;
}
