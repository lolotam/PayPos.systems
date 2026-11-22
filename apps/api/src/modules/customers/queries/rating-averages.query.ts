import { ratingAverages, ratingAveragesQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import type { RatingsListReads, RatingsListScope } from './ratings-list-reads.ts';

export interface RatingAveragesFilter {
  readonly companyId: string;
  readonly businessId: string;
  /** الفروع المسموحة بعد تقاطعها مع فلتر الفرع، وما تكونش فاضية. */
  readonly branchIds: readonly string[];
  readonly employeeId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** الساعة وتوقيت النشاط؛ بيتستخدموا بس لما `from` و`to` الاتنين غايبين. */
  readonly month: { readonly now: Date; readonly timeZone: string };
}

// أول الشهر المحلي بإزاحة شهور، محوّل لـ UTC. الحساب في SQL عشان نفس منطق 61-2a وتغيير الساعة يتحسب صح.
const monthBoundary = (f: RatingAveragesFilter, shift: number): SQL =>
  sql`((date_trunc('month', ${f.month.now.toISOString()}::timestamptz AT TIME ZONE ${f.month.timeZone})
    + ${shift}::int * interval '1 month') AT TIME ZONE ${f.month.timeZone})`;

/** الفترة على submitted_at المجرد عشان الفهرس يشتغل: صريحة لو أي حد اتبعت، وإلا الشهر الحالي. */
function window(f: RatingAveragesFilter): SQL {
  if (f.from === undefined && f.to === undefined)
    return sql`AND a.submitted_at >= ${monthBoundary(f, 0)} AND a.submitted_at < ${monthBoundary(f, 1)}`;
  const from = f.from === undefined ? sql`` : sql`AND a.submitted_at >= ${f.from}::timestamptz`;
  const to = f.to === undefined ? sql`` : sql`AND a.submitted_at < ${f.to}::timestamptz`;
  return sql`${from} ${to}`;
}

// متوسطات التقييم لكل موظفة في شاشة التقييمات في الأدمن: من rating_attributions (لقطة المطالبة) فالتقييم بمنفّذتين بيحتسب
// للاتنتين. التقريب لخانة واحدة لأعلى عند المنتصف في SQL مش في JS، وما بيطلعش رقم عشري على السلك.
export function ratingAveragesStatement(f: RatingAveragesFilter) {
  const employee = f.employeeId === undefined ? sql`` : sql`AND a.employee_id = ${f.employeeId}`;
  const branches = sql.join(
    f.branchIds.map((branchId) => sql`${branchId}::uuid`),
    sql`, `,
  );
  return sql`SELECT a.employee_id::text AS employee_id, round(avg(a.stars), 1)::text AS average,
      count(*)::int AS count
    FROM rating_attributions a
    WHERE a.company_id = ${f.companyId} AND a.business_id = ${f.businessId}
      AND a.branch_id IN (${branches}) ${employee} ${window(f)}
    GROUP BY a.employee_id ORDER BY a.employee_id`;
}

export async function readRatingAverages(
  tx: Tx,
  c: RatingsListScope,
  raw: unknown,
  now: Date,
  reads: RatingsListReads,
) {
  const allowed = await reads.access(tx, c, now);
  if (allowed.length === 0) throw new ApiError('FORBIDDEN');
  const parsed = ratingAveragesQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const q = parsed.data;
  const wanted = q.branch_id?.toLowerCase();
  const branchIds = wanted === undefined ? allowed : allowed.filter((b) => b === wanted);
  if (branchIds.length === 0) return ratingAverages.parse({ items: [] });
  const timeZone = q.from === undefined && q.to === undefined ? await reads.timeZone(tx, c) : 'UTC';
  if (timeZone === null) throw new ApiError('FORBIDDEN');
  const rows = Array.from(
    await tx.execute<{ employee_id: string; average: string; count: number }>(
      ratingAveragesStatement({
        ...c,
        branchIds,
        employeeId: q.employee_id?.toLowerCase(),
        from: q.from,
        to: q.to,
        month: { now, timeZone },
      }),
    ),
  );
  const names = await reads.employeeNames(
    tx,
    c.companyId,
    rows.map((row) => row.employee_id),
  );
  return ratingAverages.parse({
    items: rows.map((row) => ({
      ...row,
      name_ar: null,
      name_en: '',
      ...names.get(row.employee_id),
    })),
  });
}
