'use client';
import { requesterDiscountProposalList, type RequesterDiscountProposalList } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const statusPath = '/v1/businesses/{businessId}/branches/{branchId}/discount-proposals';

export function useDiscountApprovalStatus(scope: SessionServiceScope, requestId: string | null) {
  return useQuery<RequesterDiscountProposalList>({
    queryKey: ['discount-approval-status', scope.companyId, scope.businessId, scope.branchId, scope.userId, requestId],
    enabled: requestId !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      // أول قراءة فاشلة كانت بتوقف الاستطلاع فتفضل الشاشة مقفولة ومفيش مخرج؛ الاستطلاع يفضل شغّال لحد ما يوصل لبيانات.
      const items = query.state.data?.items;
      if (!items) return 5000;
      return items.some((item) => item.status === 'PENDING') ? 5000 : false;
    },
    queryFn: async ({ signal }) => {
      if (requestId === null) throw new Error('DISCOUNT_APPROVAL_REQUEST_REQUIRED');
      const result = await apiClient().GET(statusPath, {
        params: { header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId }, query: { request_id: requestId } },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return requesterDiscountProposalList.parse(result.data);
    },
  });
}
