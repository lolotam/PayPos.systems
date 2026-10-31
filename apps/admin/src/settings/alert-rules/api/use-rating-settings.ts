'use client';

import { useQuery } from '@tanstack/react-query';
import { ratingSettingsKey, readRatingSettings } from './alert-rules-client';

export function useRatingSettings(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: ratingSettingsKey(companyId ?? '', userId ?? '', businessId ?? ''),
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) => readRatingSettings(companyId ?? '', businessId ?? '', signal),
    retry: false,
  });
}
