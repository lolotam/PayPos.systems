'use client';

import { useQuery } from '@tanstack/react-query';
import { ratingsKey, readRatingsPage } from './ratings-client';

/** قراءة صفحة واحدة بحد 1 لتحديد ظهور عنصر القائمة: نجاحها معناه إن الخادم سمح بالقراءة. */
export function useRatingsAccess(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: [...ratingsKey(companyId ?? '', userId ?? '', businessId ?? ''), 'access'],
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) =>
      readRatingsPage(companyId ?? '', businessId ?? '', { limit: 1 }, signal),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}
