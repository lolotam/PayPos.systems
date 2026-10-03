import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export type MembershipDiscountLimitResult =
  | { readonly status: 'SET'; readonly limit_bps: number }
  | { readonly status: 'NOT_SET' }
  | { readonly status: 'MEMBERSHIP_NOT_FOUND' };

/**
 * بيقرأ الحد الشخصي داخل معاملة المستهلك؛ عدم الإعداد يترك اختيار افتراضي النشاط لـ settings.
 *
 * @param tx معاملة الشركة المؤكدة، حتى يمكن تسجيل الخدمة بنفس اللقطة
 * @param companyId الشركة المؤكدة
 * @param membershipId العضوية المطلوبة
 * @returns حد صريح أو عدم إعداد أو عضوية غير متاحة، بدون أي افتراضي مخترع
 */
export async function readMembershipDiscountLimit(
  tx: Tx,
  companyId: string,
  membershipId: string,
): Promise<MembershipDiscountLimitResult> {
  // تسجيل الخدمة في PR 35 يحتاج الحد من نفس المعاملة، ولا يقرأ عضوية منتهية أو شركة مغلقة.
  const [row] = await tx.execute<{ limit_bps: number | null }>(sql`
    SELECT m.limit_bps FROM memberships m WHERE m.company_id = ${companyId} AND m.id = ${membershipId}
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND EXISTS (SELECT 1 FROM companies WHERE id = ${companyId} AND deleted_at IS NULL)`);
  if (row === undefined) return { status: 'MEMBERSHIP_NOT_FOUND' };
  return row.limit_bps === null
    ? { status: 'NOT_SET' }
    : { status: 'SET', limit_bps: row.limit_bps };
}
