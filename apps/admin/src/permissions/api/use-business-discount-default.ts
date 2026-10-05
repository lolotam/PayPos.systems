'use client';

import { businessSettings, discountLimit, type DiscountLimitInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

async function readSettings(companyId: string, businessId: string) {
  const response = await apiClient().GET('/v1/businesses/{businessId}/settings', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
  });
  if (response.error) throw response.error;
  return businessSettings.parse(response.data);
}

async function saveDefault(companyId: string, businessId: string, body: DiscountLimitInput) {
  const response = await apiClient().POST('/v1/businesses/{businessId}/settings/discount-limit', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body,
  });
  if (response.error) throw response.error;
  return discountLimit.parse(response.data);
}

export function useBusinessDiscountDefault(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const queryKey = ['business-settings', companyId, userId, businessId];
  const query = useQuery({ queryKey, queryFn: () => readSettings(companyId, businessId) });
  const mutation = useMutation({
    mutationFn: (input: DiscountLimitInput) => saveDefault(companyId, businessId, input),
    onMutate: () => ({ queryKey }),
    onSuccess: (_saved, _body, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
  return { query, mutation };
}
