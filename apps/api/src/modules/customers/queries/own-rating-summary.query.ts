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
// الحدان المحليان للشهر ممكن يقعوا في تكرار (رجوع الساعة لمنتصف الليل) أو فجوة (تقدّم الساعة عند منتصف الليل)؛
// لذلك الحد الفعلي هو أول لحظة صالحة محليتها >= بداية الشهر المحلية، والنهاية أول لحظة محليتها >= بداية الشهر الجاية.
export function ownRatingSummaryStatement(
  c: OwnRatingContext,
  employeeId: string,
  now: Date,
  timeZone: string,
) {
  return sql`WITH month_start AS (
      SELECT date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE ${timeZone}) AS local_start
    ), bounds AS (
      SELECT (SELECT min(g.t) FROM generate_series(
          (m.local_start - interval '1 day') AT TIME ZONE ${timeZone},
          (m.local_start + interval '1 day') AT TIME ZONE ${timeZone},
          interval '1 minute') AS g(t)
        WHERE (g.t AT TIME ZONE ${timeZone}) >= m.local_start) AS window_start,
        (SELECT min(g.t) FROM generate_series(
          (m.local_start + interval '1 month' - interval '1 day') AT TIME ZONE ${timeZone},
          (m.local_start + interval '1 month' + interval '1 day') AT TIME ZONE ${timeZone},
          interval '1 minute') AS g(t)
        WHERE (g.t AT TIME ZONE ${timeZone}) >= m.local_start + interval '1 month') AS window_end
      FROM month_start m
    )
    SELECT count(*)::int AS count, round(avg(a.stars), 1)::text AS average
    FROM rating_attributions a, bounds b
    WHERE a.company_id=${c.companyId} AND a.employee_id=${employeeId}
      AND a.business_id=${c.businessId}
      AND a.submitted_at >= b.window_start
      AND a.submitted_at < b.window_end`;
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
