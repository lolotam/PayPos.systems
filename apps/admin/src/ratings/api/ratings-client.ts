import {
  ratingAverages,
  ratingsListPage,
  type RatingAverages,
  type RatingsListPage,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';
import type { RatingsPageQuery, RatingsPeriodQuery } from '../model/ratings-filters';

const listPath = '/v1/businesses/{businessId}/ratings';
const averagesPath = '/v1/businesses/{businessId}/ratings/averages';

export function ratingsKey(companyId: string, userId: string, businessId: string) {
  return ['ratings', companyId, userId, businessId] as const;
}

/** الجيل الأول بلا لاحقة، فمفاتيح الكاش القائمة تفضل زي ما هي؛ كل جيل بعده مفتاح مستقل بلا حالة قديمة. */
export function epochSuffix(epoch: number): readonly number[] {
  return epoch > 0 ? [epoch] : [];
}

let lastEpoch = 0;

/** جيل بديل فريد على مستوى التطبيق كله: صفحتان مفتوحتان على نفس الكاش ما يوصلوش لنفس المفتاح، فقراءة ما بعد الرفض ما تنضمش لطلب بدأ قبله. */
export function nextRatingsEpoch(): number {
  lastEpoch += 1;
  return lastEpoch;
}

export async function readRatingsPage(
  companyId: string,
  businessId: string,
  query: RatingsPageQuery,
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
  query: RatingsPeriodQuery,
  signal: AbortSignal,
): Promise<RatingAverages> {
  const response = await apiClient().GET(averagesPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId }, query },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return ratingAverages.parse(response.data);
}
