import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * ميزة الشركة: الـoverride لو موجود ومش منتهي، وإلا flag الباقة. الشركة المحذوفة مفيش
 * لها ميزات (ADR-0054 §9). نفس قراءة الـAPI بالظبط، عشان ميزة العمولات مقفولة في
 * الـworker معناها مقفولة في نقطة النهاية.
 *
 * @param tx        معاملة الشركة الحالية
 * @param companyId الشركة
 * @param flag      اسم الميزة
 * @returns هل الميزة مفعّلة
 */
export async function companyFeatureEnabled(
  tx: Tx,
  companyId: string,
  flag: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ enabled: boolean }>(sql`
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM companies c WHERE c.id = ${companyId} AND c.deleted_at IS NULL
    ) THEN false ELSE COALESCE(
      (SELECT o.enabled FROM company_feature_overrides o
       WHERE o.company_id = ${companyId} AND o.flag = ${flag}
         AND (o.expires_at IS NULL OR o.expires_at > now())),
      (SELECT (p.feature_flags ->> ${flag})::boolean
       FROM companies c JOIN plans p ON p.id = c.plan_id WHERE c.id = ${companyId}),
      false) END AS enabled`);
  return row?.enabled === true;
}
