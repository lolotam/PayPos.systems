import { RATING_REQUESTS_DEFAULT_ENABLED, type RatingSettings } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** شاشة التنبيهات في لوحة الإدارة: بتقرأ مفتاح طلبات التقييم للنشاط. */
export async function ratingSettingsQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<RatingSettings> {
  const [row] = await tx.execute<{ requests_enabled: boolean | null }>(sql`
    SELECT requests_enabled FROM rating_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`);
  return { requests_enabled: row?.requests_enabled ?? RATING_REQUESTS_DEFAULT_ENABLED };
}
