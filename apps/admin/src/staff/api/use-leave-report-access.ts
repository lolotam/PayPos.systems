'use client';
import { leaveHistoryPage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { isAccessProof } from '../model/leave-report-view';

const PROBE_DATE = '2000-01-01';

/**
 * فحص صلاحية واحد بيقرأ يوم واحد ثابت؛ الرفض الثقيل بيحصل بعد كل اختبارات الصلاحية، فبيلزم المطالبة.
 */
export function useLeaveReportAccess(
  companyId: string | undefined,
  businessId: string | undefined,
  userId: string | null,
) {
  const query = useQuery({
    queryKey: ['leave-report-access', companyId ?? '', businessId ?? '', userId ?? ''],
    enabled: Boolean(companyId && businessId && userId),
    retry: false,
    staleTime: 60_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/leave-history', {
        params: {
          header: { 'x-company-id': companyId ?? '' },
          path: { businessId: businessId ?? '' },
          query: { from: PROBE_DATE, to: PROBE_DATE, limit: 1 },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return leaveHistoryPage.parse(result.data);
    },
  });
  return { ...query, allowed: isAccessProof(query) };
}
