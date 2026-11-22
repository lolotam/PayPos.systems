import {
  ratingAverages,
  ratingsListPage,
  type RatingAverages,
  type RatingsListPage,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import type { RatingsRange } from '../model/ratings-filters';

const listPath = '/v1/businesses/{businessId}/ratings';
const averagesPath = '/v1/businesses/{businessId}/ratings/averages';

export function ratingsKey(companyId: string, userId: string, businessId: string) {
  return ['ratings', companyId, userId, businessId] as const;
}

export async function readRatingsPage(
  companyId: string,
  businessId: string,
  query: Partial<RatingsRange> & { employee_id?: string; cursor?: string; limit: number },
  signal: AbortSignal,
): Promise<RatingsListPage> {
  const response = await apiClient().GET(listPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId }, query },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return ratingsListPage.parse(response.data);
}

export async function readRatingAverages(
  companyId: string,
  businessId: string,
  query: RatingsRange,
  signal: AbortSignal,
): Promise<RatingAverages> {
  const response = await apiClient().GET(averagesPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId }, query },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return ratingAverages.parse(response.data);
}
