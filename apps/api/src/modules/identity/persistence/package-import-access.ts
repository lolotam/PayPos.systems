import {
  canonicalOwnerSql,
  systemRoleGrantAllowedSql,
  systemRoleOverrideAllowedSql,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/** يثبت إذن استيراد الباقات وميزة orders على نفس معاملة المعاينة، بلا اتصال ثانٍ. */
export async function readPackageImportAccess(
  tx: Tx,
  actor: { companyId: string; userId: string; businessId: string },
): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null> {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${actor.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return 'FORBIDDEN';
  // قفل FOR NO KEY UPDATE يحفظ التسلسل ضد سحب العضوية دون التعارض مع قفل FOR KEY SHARE لمفتاح الربط في العامل.
  await tx.execute(sql`SELECT id FROM memberships
    WHERE company_id=${actor.companyId} AND user_id=${actor.userId} ORDER BY id FOR NO KEY UPDATE`);
  const [business] =
    await tx.execute(sql`SELECT b.id FROM businesses b JOIN companies c ON c.id=b.company_id
    WHERE b.company_id=${actor.companyId} AND b.id=${actor.businessId} AND c.deleted_at IS NULL`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const access = await readAccessTransaction(tx, actor.companyId, actor.userId, new Date(time.at));
  if (!evaluateAccess(access.grants, 'import:packages:business', actor)) return 'FORBIDDEN';
  return (await readFeatureEnabled(tx, actor.companyId, 'orders', new Date(time.at)))
    ? null
    : 'FEATURE_DISABLED';
}

const IMPORT_PERMISSION = 'import:packages:business';

/** نتيجة إذن تثبيت الاستيراد: العضوية التي تُسجَّل مع الطلب، أو رفض مسمّى. */
export type PackageImportCommitAccess =
  { readonly membershipId: string } | 'FORBIDDEN' | 'FEATURE_DISABLED';

/**
 * يثبت إذن تثبيت استيراد الباقات وميزة orders على معاملة القبول نفسها، ويختار عضوية واحدة ثابتة
 * تُجمَّد في صف المعاينة ليسجَّلها العامل لاحقاً كمسجِّل للباقات (47-2b). الأقفال والقراءة بنفس ترتيب
 * readPackageImportAccess، فلا يختلف قرار المعاينة عن قرار التثبيت. العضوية السارية لنفس الوقت المثبّت تغطي
 * الشركة أو النشاط أو فرعاً منه، وتُفضَّل التي تمنح الصلاحية بدورها أو بمنحها الشخصي أو لأنها عضوية المالك،
 * ثم ترتيب المعرّف لثبات الاختيار. غياب أي عضوية يغطي النشاط رفض، لأن مفتاح الربط في المعاينة لا يقبل null.
 *
 * @param tx معاملة الشركة الحالية
 * @param actor الشركة والمستخدم صاحب الطلب والنشاط المؤكد
 * @returns معرّف العضوية المختارة، أو رفض مسمّى
 */
export async function readPackageImportCommitAccess(
  tx: Tx,
  actor: { companyId: string; userId: string; businessId: string },
): Promise<PackageImportCommitAccess> {
  const [company] = await tx.execute(sql`SELECT id FROM companies
    WHERE id=${actor.companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
  if (company === undefined) return 'FORBIDDEN';
  // قفل FOR NO KEY UPDATE يحفظ التسلسل ضد سحب العضوية دون التعارض مع قفل FOR KEY SHARE لمفتاح الربط في العامل.
  await tx.execute(sql`SELECT id FROM memberships
    WHERE company_id=${actor.companyId} AND user_id=${actor.userId} ORDER BY id FOR NO KEY UPDATE`);
  const [business] =
    await tx.execute(sql`SELECT b.id FROM businesses b JOIN companies c ON c.id=b.company_id
    WHERE b.company_id=${actor.companyId} AND b.id=${actor.businessId} AND c.deleted_at IS NULL`);
  if (business === undefined) return 'FORBIDDEN';
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return 'FORBIDDEN';
  const at = new Date(time.at);
  const access = await readAccessTransaction(tx, actor.companyId, actor.userId, at);
  if (!evaluateAccess(access.grants, IMPORT_PERMISSION, actor)) return 'FORBIDDEN';
  if (!(await readFeatureEnabled(tx, actor.companyId, 'orders', at))) return 'FEATURE_DISABLED';
  const stamp = sql`${at.toISOString()}::timestamptz`;
  const [membership] = await tx.execute<{ id: string }>(sql`
    SELECT m.id FROM memberships m
    WHERE m.company_id=${actor.companyId} AND m.user_id=${actor.userId}
      AND m.starts_at <= ${stamp} AND (m.ends_at IS NULL OR m.ends_at > ${stamp})
      AND (
        (m.scope_type = 'COMPANY' AND m.scope_id = ${actor.companyId})
        OR (m.scope_type = 'BUSINESS' AND m.scope_id = ${actor.businessId})
        OR (m.scope_type = 'BRANCH' AND EXISTS (
          SELECT 1 FROM branches b
          WHERE b.company_id = m.company_id AND b.id = m.scope_id AND b.business_id = ${actor.businessId}))
      )
    ORDER BY (
      EXISTS (SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
          AND rp.permission_code = ${IMPORT_PERMISSION} AND ${systemRoleGrantAllowedSql('m', 'rp')})
      OR EXISTS (SELECT 1 FROM permission_overrides o
        WHERE o.company_id = m.company_id AND o.membership_id = m.id
          AND o.permission_code = ${IMPORT_PERMISSION} AND o.effect = 'ALLOW'
          AND (o.expires_at IS NULL OR o.expires_at > ${stamp})
          AND ${systemRoleOverrideAllowedSql('m', 'o')})
      OR (${canonicalOwnerSql('m', actor.companyId)})
    ) DESC, m.id
    LIMIT 1`);
  return membership === undefined ? 'FORBIDDEN' : { membershipId: membership.id };
}
