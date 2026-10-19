'use client';

import { useQuery } from '@tanstack/react-query';
import { businessSettingsKey, readBusinessSettings } from './identity-client';

export function useBusinessSettings(companyId: string, userId: string, businessId: string) {
  return useQuery({
    queryKey: businessSettingsKey(companyId, userId, businessId),
    queryFn: () => readBusinessSettings(companyId, businessId),
  });
}
