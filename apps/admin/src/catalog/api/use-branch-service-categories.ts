'use client';
import {
  serviceCategoryBranchPage,
  type ServiceCategoryBranchPage,
  type ServiceCategoryBranchView,
} from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { serviceCategoryKey } from './use-service-category-list';

/**
 * جذر كاش قوايم فرع واحد تحت جذر قائمة التصنيفات بتاع 3a، عشان أي قفل أو تعديل
 * على مستوى النشاط يبطل الكاش ده مع القوايم التانية من غير مفتاح جديد.
 */
export const branchServiceCategoryKey = (
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
) => [...serviceCategoryKey(companyId, businessId, userId), 'branch', branchId] as const;

async function branchList(
  companyId: string,
  businessId: string,
  branchId: string,
  options: { view: ServiceCategoryBranchView; cursor?: string | undefined },
  signal: AbortSignal,
): Promise<ServiceCategoryBranchPage> {
  const response = await apiClient().GET(
    '/v1/businesses/{businessId}/branches/{branchId}/service-categories',
    {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId, branchId },
        query: {
          view: options.view,
          limit: 20,
          ...(options.cursor ? { cursor: options.cursor } : {}),
        },
      },
      signal,
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategoryBranchPage.parse(response.data);
}

/**
 * قايمة تصنيفات فرع واحد (مستخدمة أو متاحة) للقراءة بس — الشاشة مش بتلمس أي مسار
 * على مستوى النشاط لأن مدير الفرع مالوش صلاحيتها.
 */
export function useBranchServiceCategories(
  companyId: string,
  businessId: string,
  userId: string,
  branchId: string,
  options: { view: ServiceCategoryBranchView; cursor?: string | undefined },
) {
  return useQuery({
    queryKey: [
      ...branchServiceCategoryKey(companyId, businessId, userId, branchId),
      'list',
      options.view,
      options.cursor,
    ],
    queryFn: ({ signal }) => branchList(companyId, businessId, branchId, options, signal),
    refetchInterval: 30_000,
  });
}
