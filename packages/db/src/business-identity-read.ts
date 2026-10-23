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
