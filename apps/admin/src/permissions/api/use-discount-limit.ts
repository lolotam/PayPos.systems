'use client';

import { discountLimit, type DiscountLimitInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

async function saveLimit(companyId: string, membershipId: string, body: DiscountLimitInput) {
  const response = await apiClient().POST(
    '/v1/permissions/memberships/{membershipId}/discount-limit',
    {
      params: { header: { 'x-company-id': companyId }, path: { membershipId } },
      body,
    },
  );
  if (response.error) throw response.error;
  return discountLimit.parse(response.data);
}

export function useDiscountLimit(companyId: string, userId: string, membershipId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: DiscountLimitInput) => saveLimit(companyId, membershipId, body),
    onMutate: () => ({ queryKey: ['permissions', companyId, userId] }),
    onSuccess: (_saved, _body, context) => client.invalidateQueries({ queryKey: context.queryKey }),
  });
}
