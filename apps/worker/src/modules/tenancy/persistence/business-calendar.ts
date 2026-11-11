import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقرأ توقيت النشاط وتاريخ إنشائه معاً لحساب الشهر الحالي وأول شهر لإسقاط الرواتب.
 *
 * @param tx معاملة الشركة التي يملكها المستدعي
 * @param companyId الشركة المالكة للنشاط
 * @param businessId النشاط المطلوب
 * @returns التوقيت وتاريخ الإنشاء، أو null عندما لا يوجد النشاط
 */
export async function businessCalendar(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null> {
  const [row] = await tx.execute<{ timezone: string; created_at: string }>(
    sql`SELECT timezone,created_at FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
  );
  if (row === undefined) return null;
  return { timeZone: row.timezone, createdAt: new Date(row.created_at) };
}
