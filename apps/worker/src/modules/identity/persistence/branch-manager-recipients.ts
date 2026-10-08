import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

/** قراءة أهلية الشركة على معاملة المستأجر حتى لا تسجل الوظيفة إشعاراً لشركة محذوفة. */
export async function companyOpen(tx: Tx, companyId: string): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT id FROM companies
    WHERE id = ${companyId} AND deleted_at IS NULL`);
  return rows.length > 0;
}

/**
 * مستخدمو العضويات النشطة التي تغطي الفرع بدور نظام من القائمة، بلا مسح عابر للشركات.
 *
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية
 * @param roles أكواد الأدوار؛ فارغة تعني لا أحد
 * @returns معرفات المستخدمين مرتبة
 */
export async function branchManagerRecipients(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  roles: readonly string[],
): Promise<readonly string[]> {
  if (roles.length === 0) return [];
  const rows = await tx.execute<{ user_id: string }>(
    branchManagerRecipientsStatement(companyId, businessId, branchId, at, roles),
  );
  return rows.map((row) => row.user_id).sort();
}

/**
 * استعلام المستلمين بثلاثة أذرع. OFFSET 0 يُبقي شرط النطاق مسار الوصول حتى لا يقود فهرس الدور العام المسح.
 *
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @param at لحظة نافذة العضوية
 * @param roles أكواد الأدوار غير الفارغة
 * @returns جملة SQL
 */
export function branchManagerRecipientsStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  at: Date,
  roles: readonly string[],
) {
  const codes = sql.join(
    roles.map((role) => sql`${role}`),
    sql`, `,
  );
  const moment = at.toISOString();
  const covered = (scope: SQL) => sql`SELECT user_id, role_id, role_owner_key FROM memberships
    WHERE company_id = ${companyId} AND user_id IS NOT NULL
      AND starts_at <= ${moment}::timestamptz
      AND (ends_at IS NULL OR ends_at > ${moment}::timestamptz)
      AND ${scope}
    OFFSET 0`;
  const arm = (scope: SQL) => sql`SELECT s.user_id FROM (${covered(scope)}) s
    JOIN roles r ON r.id = s.role_id AND r.owner_key = s.role_owner_key
    JOIN companies c ON c.id = ${companyId}
    WHERE c.deleted_at IS NULL AND r.company_id IS NULL AND r.code IN (${codes})`;
  return sql`${arm(sql`scope_type = 'COMPANY' AND scope_id = ${companyId}`)}
    UNION ${arm(sql`scope_business_id = ${businessId}`)}
    UNION ${arm(sql`scope_branch_id = ${branchId}`)}`;
}
