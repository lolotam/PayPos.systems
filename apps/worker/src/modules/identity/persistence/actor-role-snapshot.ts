import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** لقطة دور الفاعل وقت الفعل: كود الدور واسماه وهل دور نظام ولا دور الشركة. */
export interface ActorRoleSnapshot {
  readonly role: string;
  readonly roleIsSystem: boolean;
  readonly roleNameAr: string | null;
  readonly roleNameEn: string | null;
}

/**
 * يقرأ دور عضو ساري لمستخدم في لحظة: الكود واسماه وهل هو دور نظام (`owner_key = 'global'`).
 * الترتيب يجعل دور الشركة المالك يتقدّم على غيره، فجرس وصول الدخول يسمّي المالك «المالك» لا اسم دور آخر.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param actorUserId المستخدم الفاعل
 * @param at لحظة نافذة العضوية
 * @returns اللقطة أو null إن لم يكن للمستخدم عضوية سارية
 */
export async function readActorRoleSnapshot(
  tx: Tx,
  companyId: string,
  actorUserId: string,
  at: Date,
): Promise<ActorRoleSnapshot | null> {
  const moment = at.toISOString();
  const rows = await tx.execute<{
    role: string;
    role_is_system: boolean;
    role_name_ar: string | null;
    role_name_en: string | null;
  }>(sql`
    SELECT r.code AS role, (r.owner_key = 'global') AS role_is_system,
      r.name_ar AS role_name_ar, r.name_en AS role_name_en
    FROM memberships m
    JOIN roles r ON r.owner_key = m.role_owner_key AND r.id = m.role_id
    WHERE m.company_id = ${companyId} AND m.user_id = ${actorUserId}
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
    ORDER BY CASE m.scope_type WHEN 'COMPANY' THEN 0 WHEN 'BUSINESS' THEN 1 ELSE 2 END,
      (m.role_owner_key = 'global' AND r.code = 'owner') DESC, m.id
    LIMIT 1`);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    role: row.role,
    roleIsSystem: row.role_is_system,
    roleNameAr: row.role_name_ar,
    roleNameEn: row.role_name_en,
  };
}
