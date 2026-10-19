'use client';

import { useQuery } from '@tanstack/react-query';
import { businessIdentityKey, readBusinessIdentityView } from './identity-client';

export function useBusinessIdentity(companyId: string, userId: string, businessId: string) {
  return useQuery({
    queryKey: businessIdentityKey(companyId, userId, businessId),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: () => readBusinessIdentityView(companyId, businessId),
  });
}
