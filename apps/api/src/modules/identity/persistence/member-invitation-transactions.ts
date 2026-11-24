import {
  canonicalOwnerSql,
  SYSTEM_ROLES,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  CompleteInvitationInput,
  CompleteInvitationOutcome,
  InvitationScope,
  MemberInvitationRow,
  MemberInvitationTransactions,
  OpenInvitationInput,
  OpenInvitationOutcome,
  ReissueRefusal,
} from '../ports/member-invitations.port.ts';

const INVITATION_PERMISSION = 'manage:memberships:company';

/** الأعمدة بتوصل نصوص من execute الخام؛ التواريخ بتتحول Date في toRow والقراءات التانية. */
interface InvitationRecord extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  membership_id: string | null;
  role_code: string;
  scope_type: MemberInvitationRow['scopeType'];
  scope_id: string;
  invited_by: string;
  state: MemberInvitationRow['state'];
  link_issued_at: string | null;
  created_at: string;
}

const SELECT_INVITATION = sql`
  SELECT id, user_id, membership_id, role_code, scope_type, scope_id, invited_by, state,
         link_issued_at, created_at
  FROM member_invitations`;

const toRow = (row: InvitationRecord): MemberInvitationRow => ({
  id: row.id,
  userId: row.user_id,
  membershipId: row.membership_id,
  roleCode: row.role_code,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  invitedBy: row.invited_by,
  state: row.state,
  linkIssuedAt: row.link_issued_at === null ? null : new Date(row.link_issued_at),
  createdAt: new Date(row.created_at),
});

async function authorityAllows(
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

async function scopeBelongs(
  tx: Tx,
  companyId: string,
  scope: InvitationScope,
): Promise<boolean> {
  if (scope.type === 'COMPANY') return scope.id === companyId;
  const rows =
    scope.type === 'BUSINESS'
      ? await tx.execute(sql`
          SELECT 1 FROM businesses WHERE company_id = ${companyId} AND id = ${scope.id}`)
      : await tx.execute(sql`
          SELECT 1 FROM branches WHERE company_id = ${companyId} AND id = ${scope.id}`);
  return rows.length === 1;
}

/** صف PENDING بيتعاد استخدامه بس من نفس الداعي بنفس الدور والنطاق؛ أي اختلاف بيرفض (P1-b). */
function resumeRefusal(row: InvitationRecord, input: OpenInvitationInput): boolean {
  return (
    row.state !== 'PENDING' ||
    row.invited_by !== input.actorUserId ||
    row.role_code !== input.roleCode ||
    row.scope_type !== input.scope.type ||
    row.scope_id !== input.scope.id
  );
}

/** الخطوة الأولى جوه معاملة واحدة: سلطة المالك، ونطاق تابع للشركة، وكتابة أو إعادة استخدام PENDING. */
async function openInvitation(
  tx: Tx,
  input: OpenInvitationInput,
): Promise<OpenInvitationOutcome> {
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { refusal: 'FORBIDDEN' };
  }
  if (!(await scopeBelongs(tx, input.companyId, input.scope))) {
    return { refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  const [existing] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION}
    WHERE company_id = ${input.companyId} AND email_hash = ${input.emailHash}
    FOR UPDATE`);
  if (existing !== undefined) {
    if (resumeRefusal(existing, input)) return { refusal: 'MEMBER_INVITATION_EXISTS' };
    return { invitationId: existing.id };
  }
  const insert = await tx.execute<{ id: string }>(sql`
    INSERT INTO member_invitations
      (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, created_at)
    VALUES (${input.companyId}, ${input.invitationId}, ${input.emailHash}, ${input.roleCode},
            ${input.scope.type}, ${input.scope.id}, ${input.actorUserId}, 'PENDING',
            ${input.now.toISOString()}::timestamptz)
    ON CONFLICT (company_id, email_hash) DO NOTHING
    RETURNING id`);
  if (insert.length === 1) return { invitationId: input.invitationId };
  // سباق على نفس الإيميل: الصف الفايز اتكتب بالتوازي، فالقفل هنا بيسمعه ويحكم عليه بنفس
  // قواعد الإعادة — نفس الداعي والدور والنطاق أو 409.
  const [raced] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION}
    WHERE company_id = ${input.companyId} AND email_hash = ${input.emailHash}
    FOR UPDATE`);
  if (raced !== undefined && !resumeRefusal(raced, input)) return { invitationId: raced.id };
  return { refusal: 'MEMBER_INVITATION_EXISTS' };
}

/** الخطوة الثالثة جوه معاملة واحدة: عضوية مكتوبة من الصف المقفول، وصفوف التدقيق، وحدث MemberInvited. */
async function completeInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  invitation: InvitationRecord,
): Promise<CompleteInvitationOutcome> {
  // كود الدور جاي من الصف المقفول نفسه؛ لو مش من أدوار النظام ده كسر ثابت في الجدول (500).
  const roleId = SYSTEM_ROLES.find((role) => role.code === invitation.role_code)?.id;
  if (roleId === undefined) {
    throw new Error(`member invitation role ${invitation.role_code} is not a system role`);
  }
  const row = toRow(invitation);
  await tx.execute(sql`
    INSERT INTO memberships
      (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${input.companyId}, ${input.membershipId}, ${input.userId}, ${roleId}::uuid,
            'global', ${row.scopeType}, ${row.scopeId}, ${input.now.toISOString()}::timestamptz)`);
  await tx.execute(sql`
    UPDATE member_invitations
    SET user_id = ${input.userId}, membership_id = ${input.membershipId}
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  const writers = transactionWriters(tx, ids);
  for (const entry of input.buildAudit(row, input.membershipId, input.userId)) {
    await writers.audit.record(entry);
  }
  await writers.outbox.append(input.buildEvent(row, input.membershipId, input.userId));
  return {
    done: true,
    membershipId: input.membershipId,
    userId: input.userId,
    alreadyComplete: false,
  };
}

/** إعادة إصدار الرابط جوه معاملة قافلة الصف: سلطة المالك، الدعوة من نفس المتصل، والعضوية مكتوبة. */
async function claimReissue(
  tx: Tx,
  input: { companyId: string; invitationId: string; actorUserId: string; at: Date },
): Promise<{ readonly userId: string } | { readonly refusal: ReissueRefusal }> {
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { refusal: 'FORBIDDEN' };
  }
  const [invitation] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION}
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}
    FOR UPDATE`);
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    invitation.membership_id === null ||
    invitation.user_id === null
  ) {
    return { refusal: 'MEMBER_INVITATION_NOT_REISSUEABLE' };
  }
  await tx.execute(sql`
    UPDATE member_invitations SET link_issued_at = ${input.at.toISOString()}::timestamptz
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  return { userId: invitation.user_id };
}

/** جسم معاملة الإتمام: قفل الصف، فحص السلطة والنطاق، والكتابة من الصف المقفول. */
async function completeInTransaction(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
): Promise<CompleteInvitationOutcome> {
  const [invitation] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION}
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}
    FOR UPDATE`);
  if (invitation === undefined) return { done: false, refusal: 'MEMBER_INVITATION_EXISTS' };
  if (invitation.membership_id !== null) {
    // طلب متكرر بعد نجاح سابق: بيرجّع العضوية واليوزر المسجلين بدون كتابة ولا حدث تاني.
    return {
      done: true,
      membershipId: invitation.membership_id,
      userId: input.userId,
      alreadyComplete: true,
    };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { done: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  return completeInvitation(tx, ids, input, invitation);
}

/**
 * بيبني حدود جدول الدعوات: كل خطوة بتفتح معاملتها بنفسها على pospay_app، والسلطة بتتقرأ
 * جوه كل معاملة كتابة (فتح، إتمام، حجز إعادة إصدار) عشان مفيش نافذة بين الفحص والكتابة.
 *
 * @param db  الـ tenant wrappers
 * @param ids مولّد الـ UUID v7
 * @returns حدود الدعوات
 */
export function createMemberInvitationTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): MemberInvitationTransactions {
  return {
    open: (input) =>
      db.withTenant(
        input.companyId,
        (tx) => openInvitation(tx, input),
        { userId: input.actorUserId },
      ),
    complete: (input) =>
      db.withTenant(
        input.companyId,
        async (tx): Promise<CompleteInvitationOutcome> => {
          if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
            return { done: false, refusal: 'FORBIDDEN' };
          }
          return completeInTransaction(tx, ids, input);
        },
        { userId: input.actorUserId },
      ),
    claimLink: async ({ companyId, invitationId, at }) => {
      const claimed = await db.withTenant(companyId, async (tx) =>
        tx.execute<{ id: string }>(sql`
          UPDATE member_invitations SET link_issued_at = ${at.toISOString()}::timestamptz
          WHERE company_id = ${companyId} AND id = ${invitationId} AND link_issued_at IS NULL
          RETURNING id`),
      );
      return claimed.length === 1;
    },
    claimReissue: (input) =>
      db.withTenant(
        input.companyId,
        (tx) => claimReissue(tx, input),
        { userId: input.actorUserId },
      ),
    stampLink: async ({ companyId, invitationId, actorUserId, at }) => {
      await db.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(sql`
            UPDATE member_invitations SET link_issued_at = ${at.toISOString()}::timestamptz
            WHERE company_id = ${companyId} AND id = ${invitationId}`);
          const writers = transactionWriters(tx, ids);
          await writers.audit.record({
            entity: 'member_invitation',
            entityId: invitationId,
            action: 'link.issued',
            after: { invitation_id: invitationId },
          });
        },
        { userId: actorUserId },
      );
    },
  };
}
