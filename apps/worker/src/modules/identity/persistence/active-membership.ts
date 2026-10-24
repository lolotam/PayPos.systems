import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * نطاق التغطية: نشاط الموظفة وفروعها؛ العضوية لازم تغطّي واحد منهم عشان توصل الإشعارات.
 * الـ branchIds فاضية معناها إن مفيش فرع مسموح للعضوية أن تغطيه.
 */
export interface MembershipCover {
  readonly businessId: string;
  readonly branchIds: readonly string[];
}

/**
 * هل للمستخدم عضوية سارية في الشركة في هذه اللحظة، وتغطّي نطاق الموظفة؟
 * القراءة على معاملة المستدعي بلا قفل، لأنها قراءة فقط؛ والنافذة نفسها نافذة عضوية المديرين
 * من غير join للأدوار: أي دور يحسب (ADR-0052 §5).
 * التغطية هي قاعدة الجلسة الشخصية: عضوية بنطاق الشركة، أو بنشاط الموظفة، أو بفرع من فروعها؛
 * عضوية في نشاط تاني من نفس الشركة ما تغطّي الموظفة دي، فمفيش إشعار يوصلها.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param userId المستخدم
 * @param at لحظة نافذة العضوية
 * @param cover نطاق الموظفة: نشاطها وفروعها
 * @returns true لو عند المستخدم عضوية سارية تغطّي النطاق
 */
export async function activeMembership(
  tx: Tx,
  companyId: string,
  userId: string,
  at: Date,
  cover: MembershipCover,
): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(
    activeMembershipStatement(companyId, userId, at, cover),
  );
  return rows.length > 0;
}

/**
 * جملة العضوية السارية المغطّية: بادئة الشركة ثابتة عشان تفضل مسار الفهرس، والصف الأول كفاية.
 * ذراع الفرع بيتشال لو مفيش فروع، عشان ما يطلعش IN فاضي.
 *
 * @param companyId الشركة
 * @param userId المستخدم
 * @param at لحظة نافذة العضوية
 * @param cover نطاق الموظفة: نشاطها وفروعها
 * @returns جملة SQL
 */
export function activeMembershipStatement(
  companyId: string,
  userId: string,
  at: Date,
  cover: MembershipCover,
) {
  const moment = at.toISOString();
  const branchArm =
    cover.branchIds.length === 0
      ? sql``
      : sql`OR (scope_type = 'BRANCH' AND scope_id IN (${sql.join(
          cover.branchIds.map((branchId) => sql`${branchId}::uuid`),
          sql`, `,
        )}))`;
  return sql`SELECT 1 FROM memberships
    WHERE company_id = ${companyId} AND user_id = ${userId}
      AND starts_at <= ${moment}::timestamptz
      AND (ends_at IS NULL OR ends_at > ${moment}::timestamptz)
      AND ((scope_type = 'COMPANY' AND scope_id = ${companyId})
        OR (scope_type = 'BUSINESS' AND scope_id = ${cover.businessId})
        ${branchArm})
    LIMIT 1`;
}
