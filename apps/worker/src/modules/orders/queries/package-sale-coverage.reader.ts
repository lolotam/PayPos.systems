import { sql, type SQL } from 'drizzle-orm';

import type { Tx } from '@pospay/db';

/** صفحة تغطية بيع الباقات لتقرير ما إذا كان إسقاط العمولات يغطي المصدر المحتفظ به. */
export function packageSaleCoverageStatement(
  companyId: string,
  after: string | null,
  limit: number,
): SQL {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('COVERAGE_PAGE_LIMIT_INVALID');
  }
  const page = after === null ? sql`` : sql`AND id > ${after}::uuid`;
  return sql`
    SELECT id, revision::int AS revision FROM package_entitlements
     WHERE company_id = ${companyId}
       AND provenance = 'SOLD'
       ${page}
     ORDER BY id
     LIMIT ${limit}`;
}

/**
 * يقرأ صفحة مبيعات الباقات المُباعة بمراجعاتها الحالية على معاملة المستدعي دون كتابة أو قفل،
 * والمستورَد بلا بيع فلا حدث له ولا يدخل التغطية (D-51، CS-Q51: القارئ للتأكد فقط).
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي
 * @param companyId الشركة المالكة للبيعات
 * @param after معرّف آخر بيع في الصفحة السابقة أو null للصفحة الأولى
 * @param limit أقصى عدد صفوف، من 1 إلى 500
 * @returns هويات البيعات بمراجعاتها ومؤشر الصفحة التالية عند اكتمال الصفحة
 */
export async function listCurrentPackageSales(
  tx: Tx,
  companyId: string,
  after: string | null,
  limit: number,
): Promise<{
  rows: { saleId: string; revision: number }[];
  nextAfter: string | null;
}> {
  const result = await tx.execute<{ id: string; revision: number }>(
    packageSaleCoverageStatement(companyId, after, limit),
  );
  const rows = result.map((row) => ({ saleId: row.id, revision: row.revision }));
  const last = result[result.length - 1];
  return {
    rows,
    nextAfter: result.length === limit && last !== undefined ? last.id : null,
  };
}
