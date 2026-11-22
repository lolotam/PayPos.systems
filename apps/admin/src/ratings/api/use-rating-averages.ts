'use client';

import { useQuery } from '@tanstack/react-query';
import type { RatingsRange } from '../model/ratings-filters';
import { ratingsKey, readRatingAverages } from './ratings-client';

export function useRatingAverages(
  companyId: string,
  userId: string,
  businessId: string,
  range: RatingsRange,
) {
  return useQuery({
    queryKey: [...ratingsKey(companyId, userId, businessId), 'averages', range],
    queryFn: ({ signal }) => readRatingAverages(companyId, businessId, range, signal),
    retry: false,
  });
}
