import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** اسم الخدمة كما يظهر في التقدير: الاسم الإنجليزي والعربي. */
export interface CommissionServiceName {
  readonly nameEn: string;
  readonly nameAr: string | null;
}

/**
 * أسماء خدمات النشاط لصفوف تقدير العمولة: الاسم الحيّ من الكتالوج، لأن التقدير
 * بيعرض العمل زي ما هو مش لقطة متجمدة (spec 059 D-16, FR-023). الخدمة المقفولة
 * اسمها لسه موجود، والخدمة المحذوفة مش بترجع.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param serviceIds معرّفات الخدمات المطلوبة
 * @returns اسم كل خدمة موجودة
 */
export async function readCommissionServiceNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  serviceIds: readonly string[],
): Promise<ReadonlyMap<string, CommissionServiceName>> {
  if (serviceIds.length === 0) return new Map();
  const ids = [...new Set(serviceIds)].sort();
  if (ids.length > 500) throw new RangeError('Commission service name batch size');
  const rows = await tx.execute<{
    id: string;
    nameEn: string;
    nameAr: string | null;
  }>(sql`SELECT id, name_en AS "nameEn", name_ar AS "nameAr"
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
      AND id = ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )}]::uuid[])
    ORDER BY id`);
  return new Map(
    rows.map((row) => [row.id, { nameEn: row.nameEn, nameAr: row.nameAr }] as const),
  );
}
