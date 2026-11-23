import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * الاسم الكامل للعميل لتفاصيل كشف العمولة (spec 059 D-16، D-20، CS-Q15): بيتقرا حيّاً لشهر مفتوح،
 * والمحذوف ما بيتفلترش، ومفيش تليفون بيتقرا أبداً. العميل اللي مالوش صف مش بيرجع هنا؛ قارئ الكشف
 * هو اللي بيكمّله ببديل الاسم المحذوف.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param customerIds معرّفات العملاء المطلوبة
 * @returns الاسم الكامل لكل عميل موجود، بمعرّفه
 */
export async function readCommissionCustomerNames(
  tx: Tx,
  companyId: string,
  customerIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(customerIds)].sort();
  if (ids.length === 0) return names;
  const rows = await tx.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM customers
      WHERE company_id=${companyId}
        AND id = ANY(ARRAY[${sql.join(
          ids.map((id) => sql`${id}`),
          sql`,`,
        )}]::uuid[])`,
  );
  for (const row of rows) names.set(row.id, row.name);
  return names;
}
