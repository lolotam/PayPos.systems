import type { StoredBusinessIdentity } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import type { Tx } from './with-tenant.ts';

type IdentityRow = {
  official_name_ar: string | null;
  official_name_en: string | null;
  logo_file_id: string | null;
};

/**
 * جملة قراءة هوية النشاط: الأسماء الرسمية ومعرف الشعار كما خُزّنت.
 * الـ api والـ worker يقرآن نفس الجملة، عشان البيان والتقرير لا يختلفا في المصدر.
 * نفس جملة القراءة، عشان EXPLAIN يفحص المفتاح مش نسخة تانية من الاستعلام.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @returns الجملة الجاهزة للتنفيذ أو لفحص EXPLAIN
 */
export function businessIdentityReadStatement(companyId: string, businessId: string) {
  return sql`
    SELECT official_name_ar, official_name_en, logo_file_id
    FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}`;
}

/**
 * يقرأ هوية النشاط المخزنة: الأسماء الرسمية ومعرف الشعار.
 * قراءة البيان ما تنشئش صف: الغياب ثلاثة nulls، وبايتات الشعار مش جزء من الهوية المخزنة.
 *
 * @param tx معاملة الشركة المفتوحة
 * @param companyId الشركة
 * @param businessId النشاط
 * @returns الأسماء الرسمية ومعرف الشعار المخزّن
 */
export async function readBusinessIdentity(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<StoredBusinessIdentity> {
  const [row] = await tx.execute<IdentityRow>(businessIdentityReadStatement(companyId, businessId));
  return {
    official_name_ar: row?.official_name_ar ?? null,
    official_name_en: row?.official_name_en ?? null,
    logo_file_id: row?.logo_file_id ?? null,
  };
}

/**
 * جملة قراءة معرّفات شعارات مجموعة أنشطة مرة واحدة، من غير استعلام لكل نشاط.
 * الفهرس الأساسي على (company_id, business_id) هو اللي بيخدم الشرط، فمفيش مسح للجدول.
 *
 * @param companyId الشركة
 * @param businessIds الأنشطة المطلوبة، لازم تكون غير فاضية
 * @returns الجملة الجاهزة للتنفيذ أو لفحص EXPLAIN
 */
export function businessLogoIdsReadStatement(companyId: string, businessIds: readonly string[]) {
  const ids = sql.join(
    businessIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`
    SELECT business_id, logo_file_id FROM business_settings
    WHERE company_id = ${companyId} AND logo_file_id IS NOT NULL
      AND business_id = ANY(ARRAY[${ids}]::uuid[])`;
}

/**
 * يقرأ معرّف الشعار المربوط لكل نشاط من القائمة، بقراءة واحدة للشركة كلها.
 * القراءة بتتم جوه معاملة الشركة، فبتخضع لعزل الـ RLS زي أي قراءة تانية.
 *
 * @param tx معاملة الشركة المفتوحة
 * @param companyId الشركة
 * @param businessIds الأنشطة المطلوبة
 * @returns خريطة من معرّف النشاط لمعرّف الشعار، والأنشطة بلا شعار مش فيها
 */
export async function readBusinessLogoIds(
  tx: Tx,
  companyId: string,
  businessIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (businessIds.length === 0) return new Map();
  const rows = await tx.execute<{ business_id: string; logo_file_id: string }>(
    businessLogoIdsReadStatement(companyId, businessIds),
  );
  return new Map(rows.map((row) => [row.business_id, row.logo_file_id]));
}
