import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export type MembershipDiscountLimitResult =
  | { readonly status: 'SET'; readonly limit_bps: number }
  | { readonly status: 'NOT_SET' }
  | { readonly status: 'MEMBERSHIP_NOT_FOUND' };

export type MembershipDiscountSubject =
  | { readonly status: 'MEMBERSHIP_NOT_FOUND' }
  | { readonly status: 'FOUND'; readonly limit_bps: number | null; readonly owner: boolean };

type BusinessScope = { businessId: string | null; branchIds: readonly string[] };

async function discountRow(
  tx: Tx,
  companyId: string,
  membershipId: string,
  business?: BusinessScope,
  eligibilityTime: SQL = sql`now()`,
) {
  // PR 35 يحتاج العضوية وحدها وصفة صاحبها من نفس اللقطة داخل معاملة تسجيل الخدمة.
  const [row] = await tx.execute<{ limit_bps: number | null; owner: boolean }>(sql`
    SELECT m.limit_bps, EXISTS (
      SELECT 1 FROM memberships holder JOIN roles r ON r.id=holder.role_id AND r.owner_key=holder.role_owner_key
      WHERE holder.company_id=m.company_id AND r.code='owner'
        AND (holder.user_id=m.user_id OR holder.employee_id=m.employee_id)
        AND holder.starts_at<=${eligibilityTime} AND (holder.ends_at IS NULL OR holder.ends_at>${eligibilityTime})
    ) AS owner
    FROM memberships m WHERE m.company_id=${companyId} AND m.id=${membershipId}
      AND m.starts_at<=${eligibilityTime} AND (m.ends_at IS NULL OR m.ends_at>${eligibilityTime})
      AND EXISTS (SELECT 1 FROM companies WHERE id=${companyId} AND deleted_at IS NULL)
      ${
        business === undefined
          ? sql``
          : sql`AND ${business.businessId}::uuid IS NOT NULL
          AND ((m.scope_type='COMPANY' AND m.scope_id=${companyId})
            OR (m.scope_type='BUSINESS' AND m.scope_id=${business.businessId})
            OR (m.scope_type='BRANCH' AND m.scope_id=ANY(ARRAY[
              ${sql.join(
                business.branchIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )}
            ]::uuid[])))`
      }`);
  return row;
}

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
  const row = await discountRow(tx, companyId, membershipId);
  if (row === undefined) return { status: 'MEMBERSHIP_NOT_FOUND' };
  return row.limit_bps === null
    ? { status: 'NOT_SET' }
    : { status: 'SET', limit_bps: row.limit_bps };
}

/**
 * بيقرأ الحد الشخصي وصفة المالك بشرط أن نطاق العضوية يغطي النشاط المطلوب.
 * نفس قارئ PR 7b يمنع توريث حد نشاط إلى عضوية منتهية أو تخص نشاطًا آخر.
 * وقت واحد مأخوذ بعد الأقفال يحكم أهلية العضوية وصاحبها؛ انتظار القفل لا يمد صلاحية المالك.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param membershipId العضوية المطلوبة
 * @param business النشاط وفروعه المؤكدة عبر قارئ tenancy العام في معاملة المستهلك
 * @param eligibilityAt وقت PostgreSQL الحالي الذي أخذه المستهلك بعد كل انتظار لأقفال القراءة
 * @returns حد الشخص وصفة صاحب العضوية أو عضوية غير متاحة
 */
export async function readMembershipDiscountSubject(
  tx: Tx,
  companyId: string,
  membershipId: string,
  business: BusinessScope,
  eligibilityAt: string,
): Promise<MembershipDiscountSubject> {
  const row = await discountRow(
    tx,
    companyId,
    membershipId,
    business,
    sql`${eligibilityAt}::timestamptz`,
  );
  return row === undefined ? { status: 'MEMBERSHIP_NOT_FOUND' } : { status: 'FOUND', ...row };
}
