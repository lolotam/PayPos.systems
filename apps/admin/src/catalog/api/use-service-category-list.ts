'use client';
import { serviceCategoryPage, type ServiceCategoryPage } from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export const serviceCategoryKey = (companyId: string, businessId: string, userId: string) =>
  ['service-categories', companyId, businessId, userId] as const;

async function list(
  companyId: string,
  businessId: string,
  options: { status: 'open' | 'closed' | 'all'; cursor?: string | undefined },
  signal: AbortSignal,
): Promise<ServiceCategoryPage> {
  const response = await apiClient().GET('/v1/businesses/{businessId}/service-categories', {
    params: {
      header: { 'x-company-id': companyId },
      path: { businessId },
      query: {
        status: options.status,
        limit: 20,
        ...(options.cursor ? { cursor: options.cursor } : {}),
      },
    },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategoryPage.parse(response.data);
}

/** نفس جذر الكاش بتاع قائمة التصنيفات المفتوحة عشان أي تعديل يحدّث الـpicker والفلتر مع الشاشة. */
export function useServiceCategoryList(
  companyId: string,
  businessId: string,
  userId: string,
  options: { status: 'open' | 'closed' | 'all'; cursor?: string | undefined },
) {
  return useQuery({
    queryKey: [
      ...serviceCategoryKey(companyId, businessId, userId),
      'list',
      options.status,
      options.cursor,
    ],
    queryFn: ({ signal }) => list(companyId, businessId, options, signal),
    refetchInterval: 30_000,
  });
}
