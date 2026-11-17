'use client';
import { serviceCategoryDetail, type ServiceCategoryDetail } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { serviceCategoryKey } from './use-service-category-list';

async function detail(
  companyId: string,
  businessId: string,
  categoryId: string,
  signal: AbortSignal,
): Promise<ServiceCategoryDetail> {
  const response = await apiClient().GET(
    '/v1/businesses/{businessId}/service-categories/{categoryId}',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, categoryId } },
      signal,
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategoryDetail.parse(response.data);
}

/** تفاصيل التصنيف هي مصدر revision وعدد الخدمات اللي التأكيد بيبعتهم، فمفيش طلب من غير id. */
export function useServiceCategoryDetail(
  companyId: string,
  businessId: string,
  userId: string,
  categoryId: string,
) {
  return useQuery({
    queryKey: [...serviceCategoryKey(companyId, businessId, userId), 'detail', categoryId],
    queryFn: ({ signal }) => detail(companyId, businessId, categoryId, signal),
    enabled: categoryId !== '',
    refetchOnWindowFocus: false,
  });
}
