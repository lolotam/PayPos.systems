import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** اسم فرع واحد: الاسم العربي اختياري والإنجليزي مطلوب. */
export interface BranchNameRead {
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/**
 * بيبني مصفوفة uuid كقيمة SQL مكتوبة مش كمعامل مربوط: الدريزل بيوسّع أي مصفوفة جوه sql
 * لعناصر مفصولة بفاصلة، فالمصفوفة الفاضية بتبقى استدعاء مش صالح.
 *
 * @param ids المعرفات المرتبة
 * @returns تعبير SQL من نوع uuid[]
 */
function uuidArray(ids: readonly string[]) {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/**
 * أسماء الفروع على معاملة المستدعي؛ قارئ كشف العمولة بياخد منها اسم مكان التنفيذ.
 * الفروع غير النشطة أو المقفولة بتفضل موجودة؛ الاسم مش شرط في الفلتر.
 *
 * @param tx معاملة الشركة المجدولة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchIds الفروع المطلوبة
 * @returns خريطة من معرّف الفرع إلى اسمه
 */
export async function branchNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): Promise<ReadonlyMap<string, BranchNameRead>> {
  if (branchIds.length === 0) return new Map<string, BranchNameRead>();
  const rows = await tx.execute<{
    id: string;
    name_ar: string | null;
    name_en: string;
  }>(sql`SELECT b.id, b.name_ar, b.name_en FROM branches b
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ANY(${uuidArray(branchIds)})`);
  const found: [string, BranchNameRead][] = [];
  for (const row of rows) {
    found.push([row.id, { nameAr: row.name_ar, nameEn: row.name_en }]);
  }
  return new Map(found);
}
