import { SYSTEM_ROLES, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  CompleteInvitationInput,
  CompleteInvitationOutcome,
  InvitationActor,
  InvitationScope,
  MemberInvitationTransactions,
  OpenInvitationInput,
  OpenInvitationOutcome,
  ReissueRefusal,
} from '../ports/member-invitations.port.ts';
import {
  authorityAllows,
  lockInvitation,
  lockInvitationByEmail,
  scopeBelongs,
  toRow,
  type InvitationRecord,
} from './member-invitation-records.ts';

/** صف PENDING بيتعاد استخدامه بس من نفس الداعي بنفس الدور والنطاق؛ أي اختلاف بيرفض (P1-b). */
function resumeRefused(row: InvitationRecord, input: OpenInvitationInput): boolean {
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
  ids: IdGenerator,
  input: OpenInvitationInput,
): Promise<OpenInvitationOutcome> {
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { refusal: 'FORBIDDEN' };
  }
  if (!(await scopeBelongs(tx, input.companyId, input.scope))) {
    return { refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  const existing = await lockInvitationByEmail(tx, input.companyId, input.emailHash);
  if (existing !== undefined) {
    return resumeRefused(existing, input)
      ? { refusal: 'MEMBER_INVITATION_EXISTS' }
      : { invitationId: existing.id };
  }
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO member_invitations
      (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, created_at)
    VALUES (${input.companyId}, ${input.invitationId}, ${input.emailHash}, ${input.roleCode},
            ${input.scope.type}, ${input.scope.id}, ${input.actorUserId}, 'PENDING',
            ${input.now.toISOString()}::timestamptz)
    ON CONFLICT (company_id, email_hash) DO NOTHING
    RETURNING id`);
  if (inserted.length === 1) {
    await transactionWriters(tx, ids).audit.record({
      entity: 'member_invitation',
      entityId: input.invitationId,
      action: 'invite.opened',
      after: {
        invitation_id: input.invitationId,
        role_code: input.roleCode,
        scope_type: input.scope.type,
        scope_id: input.scope.id,
      },
    });
    return { invitationId: input.invitationId };
  }
  // سباق على نفس الإيميل: الفايز اتكتب بالتوازي، فنحكم عليه بنفس قواعد الإعادة.
  const raced = await lockInvitationByEmail(tx, input.companyId, input.emailHash);
  return raced !== undefined && !resumeRefused(raced, input)
    ? { invitationId: raced.id }
    : { refusal: 'MEMBER_INVITATION_EXISTS' };
}

/** كتابة العضوية والتدقيق والحدث من الصف المقفول — كلها في معاملة الإتمام. */
async function writeMembership(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  invitation: InvitationRecord,
): Promise<void> {
  // كود الدور جاي من الصف المقفول؛ لو مش من أدوار النظام ده كسر ثابت في الجدول (500).
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
}

/** الإتمام جوه معاملة واحدة: السلطة، قفل الصف، النطاق، ثم الكتابة من الصف المقفول (P1-a، P1-b). */
async function completeInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
): Promise<CompleteInvitationOutcome> {
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { done: false, refusal: 'FORBIDDEN' };
  }
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  // اليوزر والمالك لازم يكونوا نفس اللي الصف اتفتح بيهم؛ أي اختلاف معناه صف مش بتاعنا.
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    (invitation.user_id !== null && invitation.user_id !== input.userId)
  ) {
    return { done: false, refusal: 'MEMBER_INVITATION_EXISTS' };
  }
  if (invitation.membership_id !== null) {
    return { done: true, membershipId: invitation.membership_id, alreadyComplete: true };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { done: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  await writeMembership(tx, ids, input, invitation);
  return { done: true, membershipId: input.membershipId, alreadyComplete: false };
}

/** إعادة الإصدار جوه معاملة قافلة الصف: سلطة المالك، النطاق، الدعوة من نفس المتصل، والعضوية مكتوبة. */
async function reissueClaim(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & { invitationId: string },
): Promise<{ readonly userId: string } | { readonly refusal: ReissueRefusal }> {
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { refusal: 'FORBIDDEN' };
  }
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    invitation.membership_id === null ||
    invitation.user_id === null
  ) {
    return { refusal: 'MEMBER_INVITATION_NOT_REISSUEABLE' };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  await transactionWriters(tx, ids).audit.record({
    entity: 'member_invitation',
    entityId: input.invitationId,
    action: 'link.reissue_requested',
    after: { invitation_id: input.invitationId },
  });
  return { userId: invitation.user_id };
}

/**
 * بيبني حدود جدول الدعوات: كل خطوة بتفتح معاملتها على pospay_app، والسلطة بتتقرأ جوه كل
 * معاملة كتابة (فتح، إتمام، حجز إعادة إصدار) عشان مفيش نافذة بين الفحص والكتابة.
 *
 * @param db  الـ tenant wrappers
 * @param ids مولّد الـ UUID v7
 * @returns حدود الدعوات
 */
export function createMemberInvitationTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
): MemberInvitationTransactions {
  const run = <T>(actor: InvitationActor, work: (tx: Tx) => Promise<T>): Promise<T> =>
    db.withTenant(actor.companyId, work, { userId: actor.actorUserId });
  return {
    authorize: (input) =>
      run(input, async (tx) => {
        if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) return 'FORBIDDEN';
        return (await scopeBelongs(tx, input.companyId, input.scope))
          ? null
          : 'MEMBER_ROLE_NOT_INVITABLE';
      }),
    open: (input) => run(input, (tx) => openInvitation(tx, ids, input)),
    recordRefusal: (input) =>
      run(input, async (tx) => {
        await transactionWriters(tx, ids).audit.record({
          entity: 'member_invitation',
          entityId: ids.newId(),
          action: 'invite.refused',
          after: { reason: 'EMAIL_NOT_INVITABLE' },
        });
      }),
    cancelOpened: (input) =>
      run(input, async (tx) => {
        const cancelled = await tx.execute<{ id: string }>(sql`
          UPDATE member_invitations SET state = 'CANCELLED'
          WHERE company_id = ${input.companyId} AND id = ${input.invitationId}
            AND state = 'PENDING' AND user_id IS NULL AND membership_id IS NULL
          RETURNING id`);
        if (cancelled.length === 0) return;
        await transactionWriters(tx, ids).audit.record({
          entity: 'member_invitation',
          entityId: input.invitationId,
          action: 'invite.cancelled',
          after: { invitation_id: input.invitationId, reason: 'EMAIL_NOT_INVITABLE' },
        });
      }),
    complete: (input) => run(input, (tx) => completeInvitation(tx, ids, input)),
    claimLink: async ({ companyId, invitationId, at }) => {
      const claimed = await db.withTenant(companyId, (tx) =>
        tx.execute<{ id: string }>(sql`
          UPDATE member_invitations SET link_claimed_at = ${at.toISOString()}::timestamptz
          WHERE company_id = ${companyId} AND id = ${invitationId} AND link_claimed_at IS NULL
          RETURNING id`),
      );
      return claimed.length === 1;
    },
    claimReissue: (input) => run(input, (tx) => reissueClaim(tx, ids, input)),
    stampLink: (input) =>
      run(input, async (tx) => {
        await tx.execute(sql`
          UPDATE member_invitations SET link_issued_at = ${input.at.toISOString()}::timestamptz
          WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
        await transactionWriters(tx, ids).audit.record({
          entity: 'member_invitation',
          entityId: input.invitationId,
          action: 'link.issued',
          after: { invitation_id: input.invitationId },
        });
      }),
  };
}
