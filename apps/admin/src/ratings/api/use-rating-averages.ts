'use client';

import { useQuery } from '@tanstack/react-query';
import type { RatingsPeriodQuery } from '../model/ratings-filters';
import { epochSuffix, ratingsKey, readRatingAverages } from './ratings-client';

export function useRatingAverages(
  companyId: string,
  userId: string,
  businessId: string,
  range: RatingsPeriodQuery,
  epoch = 0,
) {
  return useQuery({
    queryKey: [
      ...ratingsKey(companyId, userId, businessId),
      'averages',
      range,
      ...epochSuffix(epoch),
    ],
    queryFn: ({ signal }) => readRatingAverages(companyId, businessId, range, signal),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
  });
}
