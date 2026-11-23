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
} from '../ports/member-invitations.port.ts';

const INVITATION_PERMISSION = 'manage:memberships:company';

/** أعمدة صف الدعوة بالحروف اللي الداتابيز بيرجّعها، ومعاها فهرس عام عشان نوع execute بيتقبله. */
interface InvitationRecord extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  membership_id: string | null;
  role_code: string;
  scope_type: MemberInvitationRow['scopeType'];
  scope_id: string;
  invited_by: string;
  state: MemberInvitationRow['state'];
  link_issued_at: Date | null;
  created_at: Date;
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
  linkIssuedAt: row.link_issued_at,
  createdAt: row.created_at,
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

async function hasActiveMembership(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM memberships
    WHERE company_id = ${companyId} AND user_id = ${userId}
      AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`);
  return rows.length > 0;
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
  if (
    input.existingUserId !== null &&
    (await hasActiveMembership(tx, input.companyId, input.existingUserId))
  ) {
    return { refusal: 'MEMBER_ALREADY_IN_COMPANY' };
  }
  const insert = await tx.execute<{ id: string }>(sql`
    INSERT INTO member_invitations
      (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, created_at)
    VALUES (${input.companyId}, ${input.invitationId}, ${input.emailHash}, ${input.roleCode},
            ${input.scope.type}, ${input.scope.id}, ${input.actorUserId}, 'PENDING', ${input.now})
    RETURNING id`);
  if (insert.length === 1) return { invitationId: input.invitationId };
  return reusePendingInvitation(tx, input);
}

/** سباق على نفس الإيميل: صف PENDING موجود بيتجدد بدور ونطاق الطلب وبيتعاد استخدامه بمعرّفه (D6). */
async function reusePendingInvitation(
  tx: Tx,
  input: OpenInvitationInput,
): Promise<OpenInvitationOutcome> {
  const [existing] = await tx.execute<InvitationRecord>(sql`
    ${SELECT_INVITATION}
    WHERE company_id = ${input.companyId} AND email_hash = ${input.emailHash}
    FOR UPDATE`);
  if (existing === undefined || existing.state !== 'PENDING') {
    return { refusal: 'MEMBER_INVITATION_EXISTS' };
  }
  await tx.execute(sql`
    UPDATE member_invitations
    SET role_code = ${input.roleCode}, scope_type = ${input.scope.type}, scope_id = ${input.scope.id}
    WHERE company_id = ${input.companyId} AND id = ${existing.id}`);
  return { invitationId: existing.id };
}

/** الإتمام لصف انتهى من قبل: بيرد بالحالة الحالية بدون كتابة ولا حدث تاني (زي خطوة 3 في F1). */
const alreadyCompleteOutcome = (invitation: InvitationRecord): CompleteInvitationOutcome => ({
  done: true,
  alreadyComplete: true,
  linkIssuedAt: invitation.link_issued_at,
});

/** الخطوة الثالثة جوه معاملة واحدة: العضوية، وتحديث الدعوة، وصفوف التدقيق، وحدث MemberInvited. */
async function completeInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
): Promise<CompleteInvitationOutcome> {
  if (await hasActiveMembership(tx, input.companyId, input.userId)) {
    await tx.execute(sql`
      UPDATE member_invitations SET state = 'CANCELLED'
      WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
    return { done: false };
  }
  await insertMembership(tx, input);
  const state = input.createdByInvitation ? 'PENDING' : 'ACTIVE';
  await tx.execute(sql`
    UPDATE member_invitations
    SET user_id = ${input.userId}, membership_id = ${input.membershipId}, state = ${state}
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  const writers = transactionWriters(tx, ids);
  for (const entry of input.audit) await writers.audit.record(entry);
  await writers.outbox.append(input.event);
  return { done: true, alreadyComplete: false, linkIssuedAt: null };
}

/** كود الدور جاي من جدول الدومين المقفول؛ لو مش من أدوار النظام ده كسر ثابت في الجدول (500). */
function systemRoleId(roleCode: string): string {
  const roleId = SYSTEM_ROLES.find((role) => role.code === roleCode)?.id;
  if (roleId === undefined) throw new Error(`member invitation role ${roleCode} is not a system role`);
  return roleId;
}

async function insertMembership(tx: Tx, input: CompleteInvitationInput): Promise<void> {
  await tx.execute(sql`
    INSERT INTO memberships
      (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${input.companyId}, ${input.membershipId}, ${input.userId}, ${systemRoleId(input.roleCode)}::uuid,
            'global', ${input.scope.type}, ${input.scope.id}, ${input.now})`);
}

/**
 * بيبني حدود جدول الدعوات: كل خطوة بتفتح معاملتها بنفسها على pospay_app، والسلطة بتتقرأ
 * جوه المعاملة نفسها عشان مفيش نافذة بين الفحص والكتابة.
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
          const [invitation] = await tx.execute<InvitationRecord>(sql`
            ${SELECT_INVITATION}
            WHERE company_id = ${input.companyId} AND id = ${input.invitationId}
            FOR UPDATE`);
          if (invitation === undefined) return { done: false };
          if (invitation.membership_id !== null) return alreadyCompleteOutcome(invitation);
          return completeInvitation(tx, ids, input);
        },
        { userId: input.actorUserId },
      ),
    read: async ({ companyId, invitationId }) => {
      const rows = await db.withTenant(
        companyId,
        (tx) =>
          tx.execute<InvitationRecord>(sql`
            ${SELECT_INVITATION}
            WHERE company_id = ${companyId} AND id = ${invitationId}`),
        { readOnly: true },
      );
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    },
    stampLink: async ({ companyId, invitationId, at }) => {
      await db.withTenant(companyId, async (tx) => {
        await tx.execute(sql`
          UPDATE member_invitations SET link_issued_at = ${at}
          WHERE company_id = ${companyId} AND id = ${invitationId}`);
      });
    },
  };
}
