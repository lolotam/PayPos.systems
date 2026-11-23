'use client';

import { useQuery } from '@tanstack/react-query';
import type { RatingsPeriodQuery } from '../model/ratings-filters';
import { ratingsKey, readRatingAverages } from './ratings-client';

export function useRatingAverages(
  companyId: string,
  userId: string,
  businessId: string,
  range: RatingsPeriodQuery,
) {
  return useQuery({
    queryKey: [...ratingsKey(companyId, userId, businessId), 'averages', range],
    queryFn: ({ signal }) => readRatingAverages(companyId, businessId, range, signal),
    retry: false,
    refetchOnMount: 'always',
    staleTime: 0,
    // كل قراءة ناجحة كائن جديد حتى لو نفس الرد، عشان `useRatingsGate` يفرّق قراءة جديدة عن بيانات قديمة.
    structuralSharing: false,
  });
}
