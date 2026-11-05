import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقرأ عملاء الاستيراد باستعلام واحد ويرجع الهوية وآخر ثلاث خانات فقط، بنفس ترتيب الهواتف المدخلة.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المستوردة
 * @param phones هواتف E.164 المؤقتة في الذاكرة، دون تسجيلها
 * @returns نتيجة لكل هاتف أو null للمجهول، بلا هاتف كامل
 */
export async function readPackageImportCustomers(
  tx: Tx,
  companyId: string,
  phones: readonly string[],
): Promise<readonly ({ id: string; phone_last3: string } | null)[]> {
  if (phones.length > 500) throw new RangeError('Package import customer batch size');
  if (phones.length === 0) return [];
  try {
    const rows = await tx.execute<{
      ordinal: number;
      id: string | null;
      phone_last3: string | null;
    }>(sql`
    SELECT input.ordinality::int AS ordinal, c.id, right(substring(c.phone FROM 2), 3) AS phone_last3
    FROM unnest(ARRAY[${sql.join(
      phones.map((phone) => sql`${phone}`),
      sql`,`,
    )}]::text[])
      WITH ORDINALITY AS input(phone, ordinality)
    LEFT JOIN customers c ON c.company_id=${companyId} AND c.phone=input.phone
    ORDER BY input.ordinality`);
    return rows.map((row) =>
      row.id === null || row.phone_last3 === null
        ? null
        : { id: row.id, phone_last3: row.phone_last3 },
    );
  } catch {
    // أخطاء Drizzle قد تحمل معاملات الاستعلام وفيها الهواتف؛ لا نمرر السبب إلى السجل.
    throw new Error('PACKAGE_IMPORT_CUSTOMER_LOOKUP_FAILED');
  }
}
