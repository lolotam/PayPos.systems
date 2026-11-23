import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

/** اسم الفرع كما يظهر في كشف العمولة: العربي (اختياري) والإنجليزي. */
export interface CommissionBranchName {
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/**
 * جملة قراءة أسماء الفروع المطلوبة في نشاط واحد: معرّفاتها معامل مصفوفة واحد (مش معامل لكل فرع). مفصولة علشان
 * خطتها تتفحص بـ EXPLAIN ANALYZE في اختبارها (CLAUDE.md §9).
 *
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param branchIds معرّفات الفروع، مرتبة وبلا تكرار
 * @returns جملة SQL
 */
export function commissionBranchNamesStatement(
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): SQL {
  return sql`SELECT id, name_ar AS "nameAr", name_en AS "nameEn" FROM branches
    WHERE company_id=${companyId} AND business_id=${businessId}
      AND id = ANY(${`{${branchIds.join(',')}}`}::uuid[])`;
}

/**
 * أسماء الفروع اللي اتعمل فيها الشغل، لكشف العمولة (spec 059 D-16، D-20، CS-Q35): بتتقرا حيّة
 * لشهر مفتوح، والمحذوف ما بيتفلترش لأن بند قديم لسه بيشاور على فرعه. الفرع اللي مالوش صف مش بيرجع هنا؛
 * قارئ الكشف هو اللي بيكمّله ببديل الاسم المحذوف.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param branchIds معرّفات الفروع المطلوبة
 * @returns اسم كل فرع موجود، بمعرّفه
 */
export async function readCommissionBranchNames(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchIds: readonly string[],
): Promise<ReadonlyMap<string, CommissionBranchName>> {
  const names = new Map<string, CommissionBranchName>();
  const ids = [...new Set(branchIds)].sort();
  if (ids.length === 0) return names;
  const rows = await tx.execute<{ id: string; nameAr: string | null; nameEn: string }>(
    commissionBranchNamesStatement(companyId, businessId, ids),
  );
  for (const row of rows) names.set(row.id, { nameAr: row.nameAr, nameEn: row.nameEn });
  return names;
}
