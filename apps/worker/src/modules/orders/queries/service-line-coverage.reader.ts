import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from '@pospay/db';

/** صفحة تغطية بنود الخدمة لتقرير ما إذا كان إسقاط العمولات يغطي المصدر المحتفظ به. */
export function serviceLineCoverageStatement(
  companyId: string,
  after: string | null,
  limit: number,
): SQL {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('COVERAGE_PAGE_LIMIT_INVALID');
  }
  const page = after === null ? sql`` : sql`AND id > ${after}::uuid`;
  return sql`
    SELECT id, revision::int AS revision FROM service_lines
     WHERE company_id = ${companyId}
       ${page}
     ORDER BY id
     LIMIT ${limit}`;
}

/**
 * يقرأ صفحة بنود الخدمة المحتفظ بها، ACTIVE وCANCELLED، على معاملة المستدعي دون كتابة أو قفل.
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي
 * @param companyId الشركة المالكة للبنود
 * @param after معرّف آخر بند في الصفحة السابقة أو null للصفحة الأولى
 * @param limit أقصى عدد صفوف، من 1 إلى 500
 * @returns البنود بمراجعاتها ومؤشر الصفحة التالية عند اكتمال الصفحة
 */
export async function readServiceLineCoveragePage(
  tx: Tx,
  companyId: string,
  after: string | null,
  limit: number,
): Promise<{
  rows: { lineId: string; revision: number }[];
  nextAfter: string | null;
}> {
  const result = await tx.execute<{ id: string; revision: number }>(
    serviceLineCoverageStatement(companyId, after, limit),
  );
  const rows = result.map((row) => ({ lineId: row.id, revision: row.revision }));
  const last = result[result.length - 1];
  return {
    rows,
    nextAfter: result.length === limit && last !== undefined ? last.id : null,
  };
}
