import {
  canonicalOwnerSql,
  SYSTEM_ROLES,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  decideRatingCommentReaders,
  type RatingCommentGrant,
} from '../domain/rating-comment-access.ts';

const PERMISSION = 'read:ratings:branch';
// المديرون الأربعة وحدهم يقرؤون نص التعليق (RT-Q7b)، والدور المخصص ولو سُمّي مثلهم لا يدخل.
const MANAGER_CODES = ['owner', 'general_manager', 'business_manager', 'branch_manager'];

/**
 * عضويات المرشحين النشطة في الشركة كلها مع علم دور المدير وعلم تغطية الفرع وعلم المالك، ومنح الصلاحية:
 * منح الدور بنطاق العضوية ومنح الـ override بنطاقه هو، والـ override المنتهي يُهمل.
 * عضوية بلا دور مدير تبقى في النتيجة لأن DENY عليها يمنع المستخدم.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية والمنحة
 * @param userIds المرشحون بلا تكرار
 * @returns جملة SQL واحدة تُرجع العضويات والمنح
 */
export function ratingCommentReadersStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  userIds: readonly string[],
) {
  const moment = at.toISOString();
  // المرشحون بيتبعتوا كمعامل واحد (مصفوفة uuid بصيغة النص) مش معامل لكل مستخدم، لأن عددهم بلا سقف وPostgreSQL بيرفض أكتر من 65535 معامل في الجملة.
  const users = sql`${`{${userIds.join(',')}}`}::text::uuid[]`;
  const managerRoles = sql.join(
    SYSTEM_ROLES.filter((role) => MANAGER_CODES.includes(role.code)).map(
      (role) => sql`${role.id}::uuid`,
    ),
    sql`, `,
  );
  const covers = sql`((m.scope_type = 'COMPANY' AND m.scope_id = ${companyId}::uuid)
    OR (m.scope_type = 'BUSINESS' AND m.scope_id = ${businessId}::uuid)
    OR (m.scope_type = 'BRANCH' AND m.scope_id = ${branchId}::uuid))`;
  const granted = sql`(
    SELECT g_m.id AS membership_id, 'ALLOW'::text AS effect,
      g_m.scope_type AS scope_type, g_m.scope_id AS scope_id
    FROM memberships g_m
    JOIN role_permissions rp ON rp.role_id = g_m.role_id AND rp.role_owner_key = g_m.role_owner_key
    WHERE g_m.company_id = ${companyId} AND g_m.user_id = ANY(${users})
      AND g_m.starts_at <= ${moment}::timestamptz
      AND (g_m.ends_at IS NULL OR g_m.ends_at > ${moment}::timestamptz)
      AND rp.permission_code = ${PERMISSION}
      AND ${systemRoleGrantAllowedSql('g_m', 'rp')}
    UNION ALL
    SELECT o_m.id AS membership_id, o.effect, o.scope_type, o.scope_id
    FROM permission_overrides o
    JOIN memberships o_m ON o_m.company_id = o.company_id AND o_m.id = o.membership_id
    WHERE o_m.company_id = ${companyId} AND o_m.user_id = ANY(${users})
      AND o_m.starts_at <= ${moment}::timestamptz
      AND (o_m.ends_at IS NULL OR o_m.ends_at > ${moment}::timestamptz)
      AND o.permission_code = ${PERMISSION}
      AND (o.expires_at IS NULL OR o.expires_at > ${moment}::timestamptz)
      AND ${systemRoleOverrideAllowedSql('o_m', 'o')}
  )`;
  return sql`SELECT m.user_id, m.id AS membership_id, ${covers} AS covers,
      (m.role_owner_key = 'global' AND m.role_id IN (${managerRoles})) AS manager,
      (${canonicalOwnerSql('m', companyId)})::boolean AS owner,
      g.effect, g.scope_type, g.scope_id
    FROM memberships m
    LEFT JOIN ${granted} g ON g.membership_id = m.id
    WHERE m.company_id = ${companyId} AND m.user_id = ANY(${users})
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY m.user_id, m.id`;
}

/**
 * من يقرأ نص تعليق التقييم من بين المرشحين: مدير بدوره الحالي تغطي عضويته الفرع وتمنح read:ratings:branch،
 * ولا DENY يغطي الفرع من أي عضوية نشطة له، والمالك الحقيقي يتجاهل الـ DENY (BR-B4، RT-Q7b).
 * القراءة على معاملة المستدعي بلا قفل بجملة واحدة لكل المرشحين، لأن المسار قراءة فقط (ADR-0037 §2).
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param userIds المرشحون (مستلمو الإشعار)
 * @param at لحظة قرار الـ worker
 * @returns المؤهلون من المرشحين مرتبين بلا تكرار؛ مصفوفة فارغة بلا استعلام إن لم يوجد مرشح
 */
export async function ratingCommentReaders(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  userIds: readonly string[],
  at: Date,
): Promise<readonly string[]> {
  const candidates = [...new Set(userIds)].sort();
  if (candidates.length === 0) return [];
  const rows = await tx.execute<ReaderRow>(
    ratingCommentReadersStatement(companyId, businessId, branchId, at, candidates),
  );
  return decideRatingCommentReaders({
    branch: { companyId, businessId, branchId },
    userIds: candidates,
    memberships: rows.map((row) => ({
      userId: row.user_id,
      membershipId: row.membership_id,
      manager: row.manager === true,
      covers: row.covers === true,
    })),
    owners: [...new Set(rows.filter((row) => row.owner === true).map((row) => row.user_id))],
    grants: rows.flatMap((row) => {
      const grant = toGrant(row);
      return grant === null ? [] : [grant];
    }),
  });
}

type ReaderRow = Record<string, unknown> & {
  user_id: string;
  membership_id: string;
  covers: boolean;
  manager: boolean;
  owner: boolean;
  effect: string | null;
  scope_type: string | null;
  scope_id: string | null;
};

/** صف بلا منحة (عضوية بلا صلاحية) لا يدخل القاعدة، والصف الفاسد يُهمل لأن الـ CHECK يمنع وجوده. */
function toGrant(row: ReaderRow): RatingCommentGrant | null {
  if (row.effect === null || row.scope_type === null || row.scope_id === null) return null;
  if (row.effect !== 'ALLOW' && row.effect !== 'DENY') return null;
  if (row.scope_type !== 'COMPANY' && row.scope_type !== 'BUSINESS' && row.scope_type !== 'BRANCH')
    return null;
  return {
    userId: row.user_id,
    membershipId: row.membership_id,
    effect: row.effect,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
  };
}
