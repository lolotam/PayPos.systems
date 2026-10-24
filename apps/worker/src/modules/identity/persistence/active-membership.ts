import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * هل للمستخدم عضوية سارية في الشركة في هذه اللحظة؟
 * القراءة على معاملة المستدعي بلا قفل، لأنها قراءة فقط؛ والنافذة نفسها نافذة عضوية المديرين
 * من غير join للأدوار ومن غير قيد على النطاق: أي دور وأي نطاق يحسبان (ADR-0052 §5).
 * منتهية أو ما تبدأش العضوية معناها إن صاحبها مش موصل، فمفيش إشعار يوصله.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param userId المستخدم
 * @param at لحظة نافذة العضوية
 * @returns true لو عند المستخدم عضوية سارية في الشركة
 */
export async function activeMembership(
  tx: Tx,
  companyId: string,
  userId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx.execute<{ one: number }>(activeMembershipStatement(companyId, userId, at));
  return rows.length > 0;
}

/**
 * جملة العضوية النشطة: بادئة الشركة ثابتة عشان تفضل مسار الفهرس، والصف الأول كفاية.
 *
 * @param companyId الشركة
 * @param userId المستخدم
 * @param at لحظة نافذة العضوية
 * @returns جملة SQL
 */
export function activeMembershipStatement(companyId: string, userId: string, at: Date) {
  const moment = at.toISOString();
  return sql`SELECT 1 FROM memberships
    WHERE company_id = ${companyId} AND user_id = ${userId}
      AND starts_at <= ${moment}::timestamptz
      AND (ends_at IS NULL OR ends_at > ${moment}::timestamptz)
    LIMIT 1`;
}
