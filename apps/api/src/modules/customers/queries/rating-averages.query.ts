import { ratingAverages, ratingAveragesQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import type { RatingsListReads, RatingsListScope } from './ratings-list-reads.ts';
import { periodPredicate, resolvePeriod, type RatingsPeriod } from './ratings-period.query.ts';

export interface RatingAveragesFilter {
  readonly companyId: string;
  readonly businessId: string;
  /** الفروع المسموحة بعد تقاطعها مع فلتر الفرع، وما تكونش فاضية. */
  readonly branchIds: readonly string[];
  readonly employeeId?: string | undefined;
  /** الفترة بعد ما اتحددت من `from`/`to` أو `month` أو الشهر الحالي بتوقيت النشاط. */
  readonly period: RatingsPeriod;
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
      AND a.branch_id IN (${branches}) ${employee} ${periodPredicate(sql`a.submitted_at`, f.period)}
    GROUP BY a.employee_id ORDER BY a.employee_id`;
}

// TODO(spec): حد أقصى لمدى التاريخ (#1247 بند 4) متوقف لحد ما `060-ratings-and-staff-app` يحدّد
// الحد وكود الخطأ صراحةً؛ العقد الحالي (D-B12، FR-B15، 61-2c) يسمح بفترة مفتوحة من طرف واحد.
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
  const { period, month } = await resolvePeriod(tx, c, q, now, reads, true);
  if (branchIds.length === 0) return ratingAverages.parse({ items: [], month });
  const rows = Array.from(
    await tx.execute<{ employee_id: string; average: string; count: number }>(
      ratingAveragesStatement({
        ...c,
        branchIds,
        employeeId: q.employee_id?.toLowerCase(),
        period,
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
    month,
  });
}
