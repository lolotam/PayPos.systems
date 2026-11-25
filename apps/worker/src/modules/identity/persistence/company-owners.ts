import { canonicalOwnerSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * مالكي الشركة: عضويات المالك الحقيقية بنطاق الشركة وكلها سارية في اللحظة دي،
 * لأن تنبيه الحدث الموقوف لازم يوصل لصاحب القرار في الشركة كلها.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param at لحظة نافذة العضوية
 * @returns معرفات المستخدمين المالكين
 */
export async function companyOwners(
  tx: Tx,
  companyId: string,
  at: Date,
): Promise<readonly string[]> {
  const rows = await tx.execute<{ user_id: string }>(companyOwnersStatement(companyId, at));
  return rows.map((row) => row.user_id).sort();
}

/**
 * جملة مالكي الشركة: عضوية المالك الحقيقية فقط، بلا غيرها من الأدوار.
 *
 * @param companyId الشركة
 * @param at لحظة نافذة العضوية
 * @returns جملة SQL
 */
export function companyOwnersStatement(companyId: string, at: Date) {
  const moment = at.toISOString();
  return sql`SELECT m.user_id FROM memberships m
    WHERE m.company_id = ${companyId} AND m.user_id IS NOT NULL
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
      AND ${canonicalOwnerSql('m', companyId)}
    ORDER BY m.user_id`;
}
