import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ScopeType } from '../domain/access.ts';
import { RATINGS_READ_PERMISSION } from '../domain/ratings-read-eligibility.ts';
import {
  readableRatingBranches,
  type RatingsReadGrant,
  type RatingsReadMembership,
} from '../domain/ratings-read-scope.ts';
import { companyIsActive } from './company-active-lock.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** الشركة والنشاط والمستخدم المثبتين من الجلسة والمسار. */
export interface RatingsReadContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
}

/**
 * يثبت جوه نفس معاملة القراءة إن المستخدم يقرأ تقييمات النشاط الآن: عضوية مدير بدورها الحالي من الأربعة تغطي الفرع
 * وتحمل بذاتها `read:ratings:branch` فعّالة (نفس قاعدة الجرس، RT-Q7b)، وميزة العملاء شغالة. نشاط من شركة تانية مالوش فروع هنا فبيرجع فاضي.
 *
 * @param tx      معاملة القراءة على الشركة
 * @param context الشركة والنشاط والمستخدم المثبتين من الجلسة والمسار
 * @param now     عينة الساعة المشتركة
 * @returns الفروع المسموحة، وفاضية لما مفيش وصول
 */
export async function readRatingsReadAccess(
  tx: Tx,
  context: RatingsReadContext,
  now: Date,
): Promise<readonly string[]> {
  const { companyId, businessId, userId } = context;
  if (!(await companyIsActive(tx, companyId))) return [];
  if (!(await readFeatureEnabled(tx, companyId, 'customers', now))) return [];
  const branches = await tx.execute<{ id: string }>(
    sql`SELECT id FROM branches WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`,
  );
  const rows = await tx.execute<AccessRow>(membershipGrantsStatement(companyId, userId, now));
  const members = new Map<string, RatingsReadMembership>();
  const grants: RatingsReadGrant[] = [];
  for (const row of rows) {
    members.set(row.membership_id, {
      membershipId: row.membership_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      systemRoleCode: row.role_code,
    });
    if (row.effect !== null && row.grant_scope_type !== null && row.grant_scope_id !== null)
      grants.push({
        membershipId: row.membership_id,
        effect: row.effect,
        scopeType: row.grant_scope_type,
        scopeId: row.grant_scope_id,
      });
  }
  return readableRatingBranches(
    { companyId, businessId },
    branches.map((row) => row.id),
    [...members.values()],
    grants,
    rows.some((row) => row.owner === true),
  );
}

type AccessRow = Record<string, unknown> & {
  membership_id: string;
  scope_type: ScopeType;
  scope_id: string;
  role_code: string | null;
  owner: boolean;
  effect: 'ALLOW' | 'DENY' | null;
  grant_scope_type: ScopeType | null;
  grant_scope_id: string | null;
};

/**
 * عضويات المستخدم السارية بكود دورها النظامي وعلم المالك الحقيقي، ومنح `read:ratings:branch` لكل عضوية بمصدرها:
 * منح الدور بنطاق العضوية ومنح الـ override بنطاقه هو، والـ override المنتهي يُهمل. نفس سياسة الأدوار في SQL الـ worker.
 *
 * @param companyId الشركة
 * @param userId    المستخدم
 * @param at        لحظة نافذة العضوية والمنحة
 * @returns جملة SQL واحدة تُرجع صفاً لكل (عضوية، منحة) وصفاً واحداً لعضوية بلا منحة
 */
export function membershipGrantsStatement(companyId: string, userId: string, at: Date) {
  const moment = at.toISOString();
  return sql`SELECT m.id AS membership_id, m.scope_type, m.scope_id,
      CASE WHEN m.role_owner_key = 'global' THEN r.code END AS role_code,
      (${canonicalOwnerSql('m', companyId)})::boolean AS owner,
      g.effect, g.scope_type AS grant_scope_type, g.scope_id AS grant_scope_id
    FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    LEFT JOIN (
      SELECT g_m.id AS membership_id, 'ALLOW'::text AS effect,
        g_m.scope_type AS scope_type, g_m.scope_id AS scope_id
      FROM memberships g_m
      JOIN role_permissions rp ON rp.role_id = g_m.role_id AND rp.role_owner_key = g_m.role_owner_key
      WHERE g_m.company_id = ${companyId} AND g_m.user_id = ${userId}
        AND g_m.starts_at <= ${moment}::timestamptz
        AND (g_m.ends_at IS NULL OR g_m.ends_at > ${moment}::timestamptz)
        AND rp.permission_code = ${RATINGS_READ_PERMISSION}
        AND ${systemRoleGrantAllowedSql('g_m', 'rp')}
      UNION ALL
      SELECT o_m.id AS membership_id, o.effect, o.scope_type, o.scope_id
      FROM permission_overrides o
      JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
      WHERE o_m.company_id = ${companyId} AND o_m.user_id = ${userId}
        AND o_m.starts_at <= ${moment}::timestamptz
        AND (o_m.ends_at IS NULL OR o_m.ends_at > ${moment}::timestamptz)
        AND o.permission_code = ${RATINGS_READ_PERMISSION}
        AND (o.expires_at IS NULL OR o.expires_at > ${moment}::timestamptz)
        AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
    ) g ON g.membership_id = m.id
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY m.id`;
}
