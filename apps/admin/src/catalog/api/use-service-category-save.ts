'use client';
import {
  serviceCategory,
  type CreateServiceCategoryInput,
  type RenameServiceCategoryInput,
  type ServiceCategory,
} from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { serviceCategoryKey } from './use-service-category-list';

async function create(
  companyId: string,
  businessId: string,
  body: CreateServiceCategoryInput,
): Promise<ServiceCategory> {
  const response = await apiClient().POST('/v1/businesses/{businessId}/service-categories', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: { name_en: body.name_en, name_ar: body.name_ar },
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategory.parse(response.data);
}

async function rename(
  companyId: string,
  businessId: string,
  categoryId: string,
  body: RenameServiceCategoryInput,
): Promise<ServiceCategory> {
  const response = await apiClient().PATCH(
    '/v1/businesses/{businessId}/service-categories/{categoryId}',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, categoryId } },
      body: {
        name_en: body.name_en,
        name_ar: body.name_ar,
        expected_revision: body.expected_revision,
      },
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return serviceCategory.parse(response.data);
}

/** إنشاء التصنيف بيحدّث كل القوائم المرتبطة بالجذر، بما فيها اختيارات التصنيف في شاشة الخدمات. */
export function useCreateServiceCategory(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['create-service-category', companyId, businessId, userId],
    mutationFn: (body: CreateServiceCategoryInput) => create(companyId, businessId, body),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) }),
  });
}

/** الحفظ بـexpected_revision بس؛ visibility مش بيتبعت عشان تغييرها قرار مسار الفروع مش إعادة التسمية. */
export function useRenameServiceCategory(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['rename-service-category', companyId, businessId, userId],
    mutationFn: ({ categoryId, ...body }: RenameServiceCategoryInput & { categoryId: string }) =>
      rename(companyId, businessId, categoryId, body),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: serviceCategoryKey(companyId, businessId, userId) }),
  });
}
