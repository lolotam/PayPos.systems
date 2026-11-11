'use client';
import { customerPackageDetail } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { SessionServiceScope } from './use-session-services';

const detailPath =
  '/v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}';

export function useCustomerPackageDetail(
  scope: SessionServiceScope,
  customerId: string,
  entitlementId: string | null,
) {
  return useQuery({
    queryKey: [
      'customer-package-detail',
      scope.companyId,
      scope.businessId,
      scope.branchId,
      scope.userId,
      customerId,
      entitlementId,
    ],
    enabled: entitlementId !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (entitlementId === null) throw new Error('CUSTOMER_PACKAGE_ENTITLEMENT_MISSING');
      const result = await apiClient().GET(detailPath, {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: {
            businessId: scope.businessId,
            branchId: scope.branchId,
            customerId,
            entitlementId,
          },
        },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return customerPackageDetail.parse(result.data);
    },
  });
}
