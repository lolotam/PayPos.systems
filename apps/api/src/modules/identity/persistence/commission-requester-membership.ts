import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

const PERMISSION = 'read:commissions:business';

/**
 * عضوية المستخدم اللي بتغطي النشاط وبتدّيه صلاحية قراءة العمولات، عشان صف طلب التصدير يتربط بيها (FR-050):
 * عضوية سارية نطاقها الشركة أو النشاط ده أو فرع منه، وتفضّل اللي دورها أو منحها الشخصي بيدّي الصلاحية.
 * الترتيب بالمعرّف عشان الاختيار ثابت لما أكتر من عضوية تنطبق. العضوية للتسجيل فقط؛ الصلاحية الفعلية
 * بتتحدد بنطاق القراءة (readCommissionScope) مش بالعضوية دي.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param userId المستخدم البشري الفاعل
 * @param businessId النشاط المطلوب
 * @returns معرّف العضوية، أو null لو مفيش عضوية سارية تغطي النشاط
 */
export async function readCommissionRequesterMembership(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ id: string }>(sql`
    SELECT m.id FROM memberships m
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND (
        (m.scope_type = 'COMPANY' AND m.scope_id = ${companyId})
        OR (m.scope_type = 'BUSINESS' AND m.scope_id = ${businessId})
        OR (m.scope_type = 'BRANCH' AND EXISTS (
          SELECT 1 FROM branches b
          WHERE b.company_id = m.company_id AND b.id = m.scope_id AND b.business_id = ${businessId}))
      )
    ORDER BY (
      EXISTS (SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
          AND rp.permission_code = ${PERMISSION})
      OR EXISTS (SELECT 1 FROM permission_overrides o
        WHERE o.company_id = m.company_id AND o.membership_id = m.id
          AND o.permission_code = ${PERMISSION} AND o.effect = 'ALLOW'
          AND (o.expires_at IS NULL OR o.expires_at > now()))
    ) DESC, m.id
    LIMIT 1`);
  return row?.id ?? null;
}
