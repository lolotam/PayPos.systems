import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** اسم الخدمة كما يظهر في التقدير: الاسم الإنجليزي والعربي. */
export interface CommissionServiceName {
  readonly nameEn: string;
  readonly nameAr: string | null;
}

/** حجم الدفعة الواحدة من أسماء الخدمات؛ الطلب بيقسّم المعرفات على دفعات جوّه نفس المعاملة. */
const SERVICE_NAME_BATCH = 200;

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
  const ids = [...new Set(serviceIds)].sort();
  const names = new Map<string, CommissionServiceName>();
  for (const batch of batches(ids, SERVICE_NAME_BATCH)) {
    const rows = await tx.execute<{
      id: string;
      nameEn: string;
      nameAr: string | null;
    }>(sql`SELECT id, name_en AS "nameEn", name_ar AS "nameAr"
    FROM services WHERE company_id=${companyId} AND business_id=${businessId}
      AND id = ANY(ARRAY[${sql.join(
        batch.map((id) => sql`${id}`),
        sql`,`,
      )}]::uuid[])
    ORDER BY id`);
    for (const row of rows) {
      names.set(row.id, { nameEn: row.nameEn, nameAr: row.nameAr });
    }
  }
  return names;
}

/** تقسيم المعرفات على دفعات، عشان شهر كبير ما يوقفش الطلب. */
function batches(ids: readonly string[], size: number): readonly (readonly string[])[] {
  const result: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    result.push(ids.slice(index, index + size));
  }
  return result;
}
