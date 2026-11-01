'use client';
import {
  serviceCategoryPage,
  type ServiceCategoryListItem,
} from '@pospay/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export type ServiceCategoriesQuery = {
  data: ServiceCategoryListItem[] | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
};

export function serviceCategoryListRefused(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return error.status === 403;
}

export function omitRefusedCategory<T extends { category_id?: string | null }>(
  terms: T,
  error: unknown,
): T {
  if (!serviceCategoryListRefused(error)) return terms;
  const submitted = { ...terms };
  delete submitted.category_id;
  return submitted;
}

async function readOpenServiceCategories(
  companyId: string,
  businessId: string,
  signal: AbortSignal,
): Promise<ServiceCategoryListItem[]> {
  const items: ServiceCategoryListItem[] = [];
  let cursor: string | undefined;
  do {
    const response = await apiClient().GET('/v1/businesses/{businessId}/service-categories', {
      params: {
        header: { 'x-company-id': companyId },
        path: { businessId },
        query: { status: 'open', limit: 100, ...(cursor ? { cursor } : {}) },
      },
      signal,
    });
    if (response.error) throw { ...response.error, status: response.response.status };
    const page = serviceCategoryPage.parse(response.data);
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

export function useOpenServiceCategories(companyId: string, businessId: string, userId: string) {
  return useQuery({
    queryKey: ['service-categories', companyId, businessId, userId, 'open'],
    queryFn: ({ signal }) => readOpenServiceCategories(companyId, businessId, signal),
    retry: (failureCount, error) =>
      failureCount < 3 && !serviceCategoryListRefused(error),
  });
}
