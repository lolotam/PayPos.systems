import { ratingsListPage, ratingsListQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import { decodeRatingsCursor, encodeRatingsCursor, type RatingsCursor } from './ratings-cursor.ts';
import type { RatingsListReads, RatingsListScope } from './ratings-list-reads.ts';
import { periodPredicate, resolvePeriod, type RatingsPeriod } from './ratings-period.query.ts';

export interface RatingsListFilter {
  readonly companyId: string;
  readonly businessId: string;
  /** الفروع المسموحة بعد تقاطعها مع فلتر الفرع، وما تكونش فاضية. */
  readonly branchIds: readonly string[];
  readonly employeeId?: string | undefined;
  /** الفترة بعد ما اتحددت من `from`/`to` أو `month`؛ مفتوحة لما مفيش حاجة منهم. */
  readonly period: RatingsPeriod;
  readonly cursor: RatingsCursor | null;
  readonly limit: number;
}
type RatingRow = {
  readonly id: string;
  readonly stars: number;
  readonly submitted_at: string;
  readonly business_date: string;
  readonly branch_id: string;
  readonly comment: string | null;
  readonly performer_ids: string[];
};

/** نطاق الوقت والمؤشر على عمود submitted_at المجرد؛ `<=` الزيادة بتدي الفهرس حد بداية، والمقارنة الصف بتحسم التعادل. */
function keyset(f: RatingsListFilter, at: SQL, rank: SQL): SQL {
  const after =
    f.cursor === null
      ? sql``
      : sql`AND ${at} <= ${f.cursor.at}::timestamptz
          AND (${at}, ${rank}) < (${f.cursor.at}::timestamptz, ${f.cursor.id}::uuid)`;
  return sql`${periodPredicate(at, f.period)} ${after}`;
}

const branchList = (branchIds: readonly string[]) =>
  sql.join(
    branchIds.map((branchId) => sql`${branchId}::uuid`),
    sql`, `,
  );

// الصفحة بدون موظف: أحدث (LIMIT) تقييمات كل فرع من ratings_branch_idx بالعكس، ثم دمجها وقطعها؛ التكلفة بعدد الفروع × الصفحة
// مش بحجم التاريخ. أما بموظف فالصفحة بتبدأ من rating_attributions_employee_idx وبتجيب ratings بالمفتاح، فمفيش فرز على كل النشاط؛
// الفروع المسموحة بتتطبّق كشرط على الصفوف دي (مفيش فهرس على الموظف والفرع معاً)، فتاريخ الموظفة في فروع خارج النطاق بيتمسح ويتصفّى
// من غير ما يرجع صف منه ولا يأثر على المؤشر؛ تقييده بفهرس مركب موظف+فرع+وقت متابعة بمرحلة هجرة.
function pageRows(f: RatingsListFilter): SQL {
  const take = f.limit + 1;
  if (f.employeeId !== undefined)
    return sql`SELECT r.* FROM (
        SELECT a.rating_id, a.submitted_at FROM rating_attributions a
        WHERE a.company_id = ${f.companyId} AND a.business_id = ${f.businessId}
          AND a.employee_id = ${f.employeeId} AND a.branch_id IN (${branchList(f.branchIds)})
          ${keyset(f, sql`a.submitted_at`, sql`a.rating_id`)}
        ORDER BY a.submitted_at DESC, a.rating_id DESC LIMIT ${take}) a
      JOIN ratings r ON r.company_id = ${f.companyId} AND r.id = a.rating_id`;
  return sql`SELECT t.* FROM unnest(ARRAY[${branchList(f.branchIds)}]) AS b(id) CROSS JOIN LATERAL (
        SELECT r.* FROM ratings r
        WHERE r.company_id = ${f.companyId} AND r.business_id = ${f.businessId} AND r.branch_id = b.id
          ${keyset(f, sql`r.submitted_at`, sql`r.id`)}
        ORDER BY r.submitted_at DESC, r.id DESC LIMIT ${take}) t
      ORDER BY t.submitted_at DESC, t.id DESC LIMIT ${take}`;
}

// شاشة التقييمات في الأدمن: الأحدث أولًا بمؤشر (submitted_at, id). يوم النشاط بيتجاب من الطلب بالمفتاح بعد قطع الصفحة،
// والمنفّذات من rating_attributions (لقطة المطالبة) بالمفتاح الفريد (company, rating, employee).
export function ratingsListStatement(f: RatingsListFilter) {
  return sql`SELECT p.id, p.stars,
      to_char(p.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted_at,
      q.business_date::text AS business_date, p.branch_id, p.comment,
      ARRAY(SELECT a.employee_id::text FROM rating_attributions a
        WHERE a.company_id = p.company_id AND a.rating_id = p.id ORDER BY a.employee_id) AS performer_ids
    FROM (${pageRows(f)}) p JOIN rating_requests q ON q.company_id = p.company_id AND q.id = p.request_id
    ORDER BY p.submitted_at DESC, p.id DESC`;
}

export async function readRatingsList(
  tx: Tx,
  c: RatingsListScope,
  raw: unknown,
  now: Date,
  reads: RatingsListReads,
) {
  const allowed = await reads.access(tx, c, now);
  if (allowed.length === 0) throw new ApiError('FORBIDDEN');
  const parsed = ratingsListQuery.safeParse(raw);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const q = parsed.data;
  const wanted = q.branch_id?.toLowerCase();
  const branchIds = wanted === undefined ? allowed : allowed.filter((b) => b === wanted);
  const { period, month } = await resolvePeriod(tx, c, q, now, reads, false);
  if (branchIds.length === 0) return ratingsListPage.parse({ items: [], next_cursor: null, month });
  const rows = Array.from(
    await tx.execute<RatingRow>(
      ratingsListStatement({
        ...c,
        branchIds,
        employeeId: q.employee_id?.toLowerCase(),
        period,
        cursor: decodeRatingsCursor(q.cursor),
        limit: q.limit,
      }),
    ),
  );
  const pageRows = rows.slice(0, q.limit);
  const names = await reads.branchNames(tx, c.businessId);
  const people = await reads.employeeNames(tx, c.companyId, [
    ...new Set(pageRows.flatMap((row) => row.performer_ids)),
  ]);
  const items = pageRows.map((row) => ({
    id: row.id,
    stars: row.stars,
    submitted_at: row.submitted_at,
    business_date: row.business_date,
    branch: { id: row.branch_id, name_ar: null, name_en: '', ...names.get(row.branch_id) },
    performers: row.performer_ids.map((employee_id) => ({
      employee_id,
      name_ar: null,
      name_en: '',
      ...people.get(employee_id),
    })),
    comment: row.comment,
  }));
  const last = items.at(-1);
  return ratingsListPage.parse({
    items,
    next_cursor:
      rows.length > q.limit && last !== undefined
        ? encodeRatingsCursor(last.submitted_at, last.id)
        : null,
    month,
  });
}
