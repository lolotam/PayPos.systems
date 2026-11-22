import { ownRatingSummary, ownRatingSummaryQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import {
  ownRatingAuthority,
  type OwnRatingContext,
  type OwnRatingReads,
} from './own-rating-context.ts';

// كارت متوسط تقييمي في شاشة شغلي (61-3): تقييمات الموظفة لنفسها في شهر توقيت النشاط الحالي فقط.
// شرط UTC الواسع يستعمل الفهرس، وفلتر الشهر المحلي يشيل الجزء اللي رجع للشهر السابق وقت تغيير الساعة.
export function ownRatingSummaryStatement(
  c: OwnRatingContext,
  employeeId: string,
  now: Date,
  timeZone: string,
) {
  return sql`WITH month_start AS (
      SELECT date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone}) AS local_start
    )
    SELECT count(*)::int AS count, round(avg(a.stars), 1)::text AS average
    FROM rating_attributions a, month_start m
    WHERE a.company_id=${c.companyId} AND a.employee_id=${employeeId}
      AND a.business_id=${c.businessId}
      AND a.submitted_at >= ((m.local_start - interval '1 day') AT TIME ZONE 'UTC')
      AND a.submitted_at < ((m.local_start + interval '1 month 1 day') AT TIME ZONE 'UTC')
      AND date_trunc('month', a.submitted_at AT TIME ZONE ${timeZone}) = m.local_start`;
}

export async function readOwnRatingSummary(
  tx: Tx,
  c: OwnRatingContext,
  raw: unknown,
  now: Date,
  reads: OwnRatingReads,
) {
  const live = await ownRatingAuthority(tx, c, raw, now, reads);
  const parsed = ownRatingSummaryQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const allowed = await reads.allowed(tx, c.companyId, c.businessId);
  if (!allowed.has('rating_average')) return ownRatingSummary.parse({ visibility: 'HIDDEN' });
  const row = (
    await tx.execute<{ count: number; average: string | null }>(
      ownRatingSummaryStatement(c, live.employeeId, now, live.timeZone),
    )
  )[0];
  return ownRatingSummary.parse({
    visibility: 'VISIBLE',
    average: row?.average ?? null,
    count: row?.count ?? 0,
  });
}
