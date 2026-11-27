import { canonicalOwnerSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { InvitationScope, MemberInvitationRow } from '../ports/member-invitations.port.ts';

const INVITATION_PERMISSION = 'manage:memberships:company';

/** صف الدعوة الخام: execute بيرجّع الأعمدة بأسمائها في الجدول. */
export interface InvitationRecord extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  membership_id: string | null;
  role_code: string;
  scope_type: MemberInvitationRow['scopeType'];
  scope_id: string;
  invited_by: string;
  state: MemberInvitationRow['state'];
  /** drizzle بيرجّع الوقت نص من execute؛ بنحوّله Date عند الاستخدام. */
  created_at: string | Date;
}

export const SELECT_INVITATION = sql`
  SELECT id, user_id, membership_id, role_code, scope_type, scope_id, invited_by, state, created_at
  FROM member_invitations`;

export const toRow = (row: InvitationRecord): MemberInvitationRow => ({
  id: row.id,
  userId: row.user_id,
  membershipId: row.membership_id,
  roleCode: row.role_code,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  invitedBy: row.invited_by,
  state: row.state,
});

/** صف الدعوة بمعرفه، مقفول لحد آخر المعاملة؛ undefined لما مش موجود. */
export async function lockInvitation(
  tx: Tx,
  companyId: string,
  invitationId: string,
): Promise<InvitationRecord | undefined> {
  const [row] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION} WHERE company_id = ${companyId} AND id = ${invitationId} FOR UPDATE`);
  return row;
}

/** صف الدعوة الحي (مش CANCELLED) بحسب بصمة الإيميل في الشركة، مقفول؛ undefined لما مفيش. */
export async function lockInvitationByEmail(
  tx: Tx,
  companyId: string,
  emailHash: string,
): Promise<InvitationRecord | undefined> {
  const [row] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION} WHERE company_id = ${companyId} AND email_hash = ${emailHash} AND state <> 'CANCELLED'
    FOR UPDATE`);
  return row;
}

/** المالك الأساسي للشركة، من غير DENY على الصلاحية، وبالحالة وقت المعاملة (P1-a). */
export async function authorityAllows(
  tx: Tx,
  companyId: string,
  actorUserId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships m
    WHERE m.company_id = ${companyId} AND m.user_id = ${actorUserId}
      AND m.starts_at <= now() AND (m.ends_at IS NULL OR m.ends_at > now())
      AND ${canonicalOwnerSql('m', companyId)}
      AND EXISTS (SELECT 1 FROM role_permissions rp
                  WHERE rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
                    AND rp.permission_code = ${INVITATION_PERMISSION})
      AND NOT EXISTS (SELECT 1 FROM permission_overrides o
                      WHERE o.company_id = m.company_id AND o.membership_id = m.id
                        AND o.permission_code = ${INVITATION_PERMISSION} AND o.effect = 'DENY'
                        AND (o.expires_at IS NULL OR o.expires_at > now())
                        AND o.scope_type = 'COMPANY' AND o.scope_id = ${companyId})`);
  return rows.length === 1;
}

/** هل النطاق تابع للشركة: الشركة نفسها، أو نشاط أو فرع من شركتها. */
export async function scopeBelongs(
  tx: Tx,
  companyId: string,
  scope: InvitationScope,
): Promise<boolean> {
  if (scope.type === 'COMPANY') return scope.id === companyId;
  const rows =
    scope.type === 'BUSINESS'
      ? await tx.execute(
          sql`SELECT 1 FROM businesses WHERE company_id = ${companyId} AND id = ${scope.id}`,
        )
      : await tx.execute(
          sql`SELECT 1 FROM branches WHERE company_id = ${companyId} AND id = ${scope.id}`,
        );
  return rows.length === 1;
}

/** النطاقات كلها بتتبع الشركة: استعلامين مجموعين مش استعلام لكل نطاق. */
export async function scopesBelong(
  tx: Tx,
  companyId: string,
  scopes: readonly InvitationScope[],
): Promise<boolean> {
  if (scopes.some((scope) => scope.type === 'COMPANY' && scope.id !== companyId)) return false;
  const businessIds = scopeIds(scopes, 'BUSINESS');
  const branchIds = scopeIds(scopes, 'BRANCH');
  if (businessIds.length > 0) {
    const rows = await tx.execute(sql`
      SELECT id FROM businesses WHERE company_id = ${companyId}
        AND id = ANY(ARRAY[${sql.join(
          businessIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )}]::uuid[])`);
    if (rows.length !== businessIds.length) return false;
  }
  if (branchIds.length > 0) {
    const rows = await tx.execute(sql`
      SELECT id FROM branches WHERE company_id = ${companyId}
        AND id = ANY(ARRAY[${sql.join(
          branchIds.map((id) => sql`${id}::uuid`),
          sql`,`,
        )}]::uuid[])`);
    if (rows.length !== branchIds.length) return false;
  }
  return true;
}

/** معرّفات النطاقات من نوع واحد، من غير تكرار. */
function scopeIds(scopes: readonly InvitationScope[], type: InvitationScope['type']): string[] {
  return [...new Set(scopes.filter((scope) => scope.type === type).map((scope) => scope.id))];
}

/** صف الشركة مقفول: القفل بيتاخد قبل صف الدعوة عشان ترتيب القفل يبقى واحد مع مسار الصلاحيات. */
export async function lockCompany(tx: Tx, companyId: string): Promise<void> {
  await tx.execute(sql`
    SELECT id FROM companies WHERE id = ${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`);
}

/** واحدة على الأقل من عضويات المدعوّ المرتبطة بالدعوة لسه سارية؛ لو انتهت كلها بـ EndMembership مفيش إصدار رابط عليها. */
export async function activeMembership(
  tx: Tx,
  companyId: string,
  membershipId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships
    WHERE company_id = ${companyId} AND (id = ${membershipId} OR user_id = ${userId})
      AND (ends_at IS NULL OR ends_at > now())`);
  return rows.length > 0;
}
