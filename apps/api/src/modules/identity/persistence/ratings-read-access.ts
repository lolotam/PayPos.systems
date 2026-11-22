import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ScopeType } from '../domain/access.ts';
import { readableRatingBranches } from '../domain/ratings-read-scope.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** الشركة والنشاط والمستخدم المثبتين من الجلسة والمسار. */
export interface RatingsReadContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
}

/**
 * يثبت جوه نفس معاملة القراءة إن المستخدم يقرأ تقييمات النشاط الآن: دوره الحالي من المديرين الأربعة،
 * وصلاحية `read:ratings:branch` فعّالة، وميزة العملاء شغالة. نشاط من شركة تانية مالوش فروع هنا فبيرجع فاضي.
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
  const access = await readAccessTransaction(tx, companyId, userId, now);
  if (!(await readFeatureEnabled(tx, companyId, 'customers', now))) return [];
  const at = now.toISOString();
  const branches = await tx.execute<{ id: string }>(
    sql`SELECT id FROM branches WHERE company_id=${companyId} AND business_id=${businessId} ORDER BY id`,
  );
  const members = await tx.execute<{
    scope_type: ScopeType;
    scope_id: string;
    role_code: string | null;
  }>(sql`SELECT m.scope_type, m.scope_id,
      CASE WHEN m.role_owner_key = 'global' THEN r.code END AS role_code
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${companyId} AND m.user_id = ${userId}
      AND m.starts_at <= ${at}::timestamptz AND (m.ends_at IS NULL OR m.ends_at > ${at}::timestamptz)`);
  return readableRatingBranches(
    { companyId, businessId },
    branches.map((row) => row.id),
    members.map((row) => ({
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      systemRoleCode: row.role_code,
    })),
    access.grants,
  );
}
