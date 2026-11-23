'use client';

import type { RatingsListPage } from '@pospay/contracts';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { RatingsPeriodQuery } from '../model/ratings-filters';
import { ratingsKey, readRatingsPage } from './ratings-client';

const pageSize = 20;

export function useRatingsList(
  companyId: string,
  userId: string,
  businessId: string,
  range: RatingsPeriodQuery,
  employeeId: string,
) {
  const query = { ...range, ...(employeeId ? { employee_id: employeeId } : {}), limit: pageSize };
  return useInfiniteQuery<
    RatingsListPage,
    Error,
    InfiniteData<RatingsListPage>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: [...ratingsKey(companyId, userId, businessId), 'list', query],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      readRatingsPage(
        companyId,
        businessId,
        { ...query, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    retry: false,
  });
}
