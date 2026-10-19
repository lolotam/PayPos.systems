'use client';

import { useQuery } from '@tanstack/react-query';
import { businessIdentityAccessKey, readIdentityCapability } from './identity-client';

export function useBusinessIdentityAccess(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: businessIdentityAccessKey(companyId ?? '', userId ?? '', businessId ?? ''),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: () => {
      if (!companyId || !businessId) return false;
      return readIdentityCapability(companyId, businessId);
    },
  });
}
