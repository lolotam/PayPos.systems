import { sql } from 'drizzle-orm';

import type { Tx } from './with-tenant.ts';

/**
 * يقفل صف إعدادات النشاط ويبلّغ إن كان الملف ما زال الشعار.
 * api والـ worker يستدعيان هذه الدالة حتى يبقى فحص الربط على تنفيذ واحد.
 * صف غير موجود لا يُقفل وحده: الإنشاء الفارغ ثم FOR UPDATE ينتظر الربط المتزامن مثل findForUpdate.
 *
 * @param tx معاملة الشركة المفتوحة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param fileId الملف محل السؤال
 * @returns true إذا كان logo_file_id يساوي الملف
 */
export async function lockBusinessLogoReference(
  tx: Tx,
  companyId: string,
  businessId: string,
  fileId: string,
): Promise<boolean> {
  await tx.execute(sql`
    INSERT INTO business_settings (company_id, business_id)
    VALUES (${companyId}, ${businessId})
    ON CONFLICT (company_id, business_id) DO NOTHING`);
  const [row] = await tx.execute<{ logo_file_id: string | null }>(sql`
    SELECT logo_file_id FROM business_settings
    WHERE company_id = ${companyId} AND business_id = ${businessId}
    FOR UPDATE`);
  return row?.logo_file_id === fileId;
}
