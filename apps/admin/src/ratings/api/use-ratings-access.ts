'use client';

import { useQuery } from '@tanstack/react-query';
import { ratingsKey, readRatingsAccess } from './ratings-client';

/** فحص صلاحية القراءة لتحديد ظهور عنصر القائمة: نتيجته `{ allowed: true }` بس، فمافيش صفوف ولا تعليقات في الكاش. */
export function useRatingsAccess(
  companyId: string | undefined,
  userId: string | null,
  businessId: string | undefined,
) {
  return useQuery({
    queryKey: [...ratingsKey(companyId ?? '', userId ?? '', businessId ?? ''), 'access'],
    enabled: Boolean(companyId && userId && businessId),
    queryFn: ({ signal }) => readRatingsAccess(companyId ?? '', businessId ?? '', signal),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}
