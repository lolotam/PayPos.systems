import { SYSTEM_ROLES, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type {
  CompleteInvitationInput,
  CompleteInvitationOutcome,
  InvitationActor,
  InvitationScope,
  LinkClaimInput,
  LinkClaimOutcome,
  MemberInvitationTransactions,
  OpenInvitationInput,
  OpenInvitationOutcome,
  ReissueRefusal,
  StaleInvitationInput,
} from '../ports/member-invitations.port.ts';
import {
  activeMembership,
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

/** سلطة المالك ثم نطاق تابع للشركة، بالحالة وقت المعاملة؛ null لما الاتنين سليمين. */
async function authorityRefusal(
  tx: Tx,
  actor: InvitationActor,
  scope: InvitationScope,
): Promise<'FORBIDDEN' | 'MEMBER_ROLE_NOT_INVITABLE' | null> {
  if (!(await authorityAllows(tx, actor.companyId, actor.actorUserId))) return 'FORBIDDEN';
  return (await scopeBelongs(tx, actor.companyId, scope)) ? null : 'MEMBER_ROLE_NOT_INVITABLE';
}

/**
 * دعوة عالقة من غير حساب: صف PENDING لسه فاضي (الطلب وقف بعد الفتح وقبل إنشاء الحساب) وعدّى
 * عليه الوقت، ومحدش يقدر يكمله — فبيتلغى تحت قفل الصف والدعوة الجديدة بتكتب مكانه (AC-ACT-20).
 * ولو الحساب القائم عملية تانية غير الصف ده، فالصف ما بيستأنفش كمان: الاستئناف هيصطدم بالحساب.
 *
 * @returns true لما الصف اتلغى، false لما الصف ما ينفعش يتلمس
 */
async function reclaimStaleRow(
  tx: Tx,
  ids: IdGenerator,
  input: OpenInvitationInput,
  row: InvitationRecord,
): Promise<boolean> {
  const staleBefore = input.staleBefore;
  if (staleBefore === undefined) return false;
  if (row.state !== 'PENDING' || row.user_id !== null || row.membership_id !== null) return false;
  if (new Date(row.created_at).getTime() >= staleBefore.getTime()) return false;
  const resumable = !resumeRefused(row, input);
  const sameOperation = input.accountOperationId === undefined || input.accountOperationId === row.id;
  if (resumable && sameOperation) return false;
  await tx.execute(sql`
    UPDATE member_invitations SET state = 'CANCELLED'
    WHERE company_id = ${input.companyId} AND id = ${row.id} AND state = 'PENDING'
      AND user_id IS NULL AND membership_id IS NULL`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'member_invitation',
    entityId: row.id,
    action: 'invite.abandoned',
    after: { invitation_id: row.id, reason: 'NEVER_COMPLETED' },
  });
  return true;
}

/**
 * الخطوة الأولى جوه معاملة واحدة: قفل صف الإيميل الأول، وبعده بس قراءة السلطة والنطاق (عشان DENY اتسجل
 * وإحنا مستنيين القفل ما يفوتناش)، ثم كتابة أو إعادة استخدام PENDING. الصف الملغي مش بيحجز الإيميل.
 */
async function openInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: OpenInvitationInput,
): Promise<OpenInvitationOutcome> {
  const existing = await lockInvitationByEmail(tx, input.companyId, input.emailHash);
  const refusal = await authorityRefusal(tx, input, input.scope);
  if (refusal !== null) return { refusal };
  if (existing !== undefined) {
    const reclaimed = await reclaimStaleRow(tx, ids, input, existing);
    if (!reclaimed) {
      return resumeRefused(existing, input)
        ? { refusal: 'MEMBER_INVITATION_EXISTS' }
        : { invitationId: existing.id };
    }
  }
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO member_invitations
      (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, created_at)
    VALUES (${input.companyId}, ${input.invitationId}, ${input.emailHash}, ${input.roleCode},
            ${input.scope.type}, ${input.scope.id}, ${input.actorUserId}, 'PENDING',
            ${input.now.toISOString()}::timestamptz)
    ON CONFLICT (company_id, email_hash) WHERE state <> 'CANCELLED' DO NOTHING
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
  const racedRefusal = await authorityRefusal(tx, input, input.scope);
  if (racedRefusal !== null) return { refusal: racedRefusal };
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

/** الإتمام جوه معاملة واحدة: قفل الصف، ثم السلطة، ثم النطاق قبل أي رد «اتكمل قبل كده»، ثم الكتابة (P1-a، P1-b). */
async function completeInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
): Promise<CompleteInvitationOutcome> {
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { done: false, refusal: 'FORBIDDEN' };
  }
  // اليوزر والمالك لازم يكونوا نفس اللي الصف اتفتح بيهم؛ أي اختلاف معناه صف مش بتاعنا.
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    (invitation.user_id !== null && invitation.user_id !== input.userId)
  ) {
    return { done: false, refusal: 'MEMBER_INVITATION_EXISTS' };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { done: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  if (invitation.membership_id !== null) {
    return { done: true, membershipId: invitation.membership_id, alreadyComplete: true };
  }
  await writeMembership(tx, ids, input, invitation);
  return { done: true, membershipId: input.membershipId, alreadyComplete: false };
}

/**
 * حجز إصدار الرابط الأول: قفل صف الدعوة، سلطة المالك، النطاق، ثم تحديث ذري على link_claimed_at.
 * الحجز بعد الإتمام في معاملة منفصلة، فسلطة المالك أو النطاق ممكن يتسحبوا في النافذة دي
 * والطلب بيرفض بدل ما الرابط يطلع (AC-ACT-19).
 */
async function claimLink(tx: Tx, input: LinkClaimInput): Promise<LinkClaimOutcome> {
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { claimed: false, refusal: 'FORBIDDEN' };
  }
  // الصف لازم يبقى دعوة المالك نفسه وهي PENDING وعضويتها مكتوبة؛ أي اختلاف معناها مش صفّنا.
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    invitation.membership_id === null ||
    invitation.user_id === null
  ) {
    return { claimed: false, refusal: 'MEMBER_INVITATION_EXISTS' };
  }
  if (!(await activeMembership(tx, input.companyId, invitation.membership_id))) {
    return { claimed: false, refusal: 'MEMBER_INVITATION_EXISTS' };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { claimed: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  const claimed = await tx.execute<{ id: string }>(sql`
    UPDATE member_invitations SET link_claimed_at = ${input.at.toISOString()}::timestamptz
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId} AND link_claimed_at IS NULL
    RETURNING id`);
  return claimed.length === 1
    ? { claimed: true }
    : { claimed: false, refusal: 'MEMBER_INVITATION_EXISTS' };
}

/** إعادة الإصدار جوه معاملة قافلة الصف: سلطة المالك، النطاق، الدعوة من نفس المتصل، والعضوية مكتوبة. */
async function reissueClaim(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & { invitationId: string },
): Promise<{ readonly userId: string } | { readonly refusal: ReissueRefusal }> {
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
    return { refusal: 'FORBIDDEN' };
  }
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    invitation.membership_id === null ||
    invitation.user_id === null
  ) {
    return { refusal: 'MEMBER_INVITATION_NOT_REISSUEABLE' };
  }
  if (!(await activeMembership(tx, input.companyId, invitation.membership_id))) {
    return { refusal: 'MEMBER_INVITATION_NOT_REISSUEABLE' };
  }
  const scope: InvitationScope = { type: invitation.scope_type, id: invitation.scope_id };
  if (!(await scopeBelongs(tx, input.companyId, scope))) {
    return { refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
  }
  // الإصدار بيقفل خانة الحجز الأول: الحجز مرة واحدة بس، فالتعويض ما بيفتحش الباب لدعوة تانية
  // تاخد الرابط (AC-ACT-19).
  await tx.execute(sql`
    UPDATE member_invitations SET link_claimed_at = COALESCE(link_claimed_at, now())
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'member_invitation',
    entityId: input.invitationId,
    action: 'link.reissue_requested',
    after: { invitation_id: input.invitationId },
  });
  return { userId: invitation.user_id };
}

/** إلغاء دعوة ما اتكتبش لها يوزر ولا عضوية، وتدقيق الإلغاء — بس لو لسه PENDING وفاضية. */
async function cancelOpenedInvitation(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & { invitationId: string },
): Promise<void> {
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
}

/**
 * بيلغي دعوة لسه ما اتكملتش (PENDING من غير يوزر ولا عضوية) تحت قفل صفها، ويسجّل التدقيق؛ الدعوة
 * الملغية قبل كده بتتحسب ملغية (تكرار آمن بعد انقطاع). أي فحص سلطة إضافي بيتنادى بعد القفل بترتيب
 * محدد — عشان DENY اتسجل وإحنا مستنيين القفل ما يفوتناش (نفس ترتيب open/complete/claimReissue).
 * true معناها: مفيش عضوية واتقفل الإتمام، فحساب العملية دي يتمسح بأمان. false: الدعوة اتكملت أو
 * مش من حق المتصل يلغيها دلوقتي.
 */
async function cancelUnfinished(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & { invitationId: string },
  mayCancel: (row: InvitationRecord) => boolean,
  authorityRefused?: (lockedTx: Tx) => Promise<boolean>,
): Promise<boolean> {
  const row = await lockInvitation(tx, input.companyId, input.invitationId);
  if (authorityRefused !== undefined && (await authorityRefused(tx))) return false;
  if (row === undefined || row.membership_id !== null || row.user_id !== null) return false;
  if (row.state === 'CANCELLED') return true;
  if (row.state !== 'PENDING' || !mayCancel(row)) return false;
  await tx.execute(sql`
    UPDATE member_invitations SET state = 'CANCELLED'
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'member_invitation',
    entityId: input.invitationId,
    action: 'invite.abandoned',
    after: { invitation_id: input.invitationId, reason: 'NEVER_COMPLETED' },
  });
  return true;
}

/** دعوة عالقة قديمة: المتصل مش هيكملها بنفس الدور والنطاق، وعدّى عليها وقت يكفي إن مفيش طلب شغال فيها. */
function staleFor(input: StaleInvitationInput) {
  return (row: InvitationRecord): boolean => {
    const resumable =
      row.invited_by === input.actorUserId &&
      row.role_code === input.roleCode &&
      row.scope_type === input.scope.type &&
      row.scope_id === input.scope.id;
    return !resumable && new Date(row.created_at).getTime() < input.staleBefore.getTime();
  };
}

/** ختم وقت الإصدار الفعلي بعد كتابة التوكن، وتدقيق «link.issued» من غير أي سر. */
async function stampIssuedLink(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & { invitationId: string; at: Date },
): Promise<void> {
  await tx.execute(sql`
    UPDATE member_invitations SET link_issued_at = ${input.at.toISOString()}::timestamptz
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'member_invitation',
    entityId: input.invitationId,
    action: 'link.issued',
    after: { invitation_id: input.invitationId },
  });
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
      run(input, (tx) =>
        transactionWriters(tx, ids).audit.record({
          entity: 'member_invitation',
          entityId: ids.newId(),
          action: 'invite.refused',
          after: { reason: 'EMAIL_NOT_INVITABLE' },
        }),
      ),
    cancelOpened: (input) => run(input, (tx) => cancelOpenedInvitation(tx, ids, input)),
    abandonOwn: (input) =>
      run(input, (tx) =>
        cancelUnfinished(tx, ids, input, (row) => row.invited_by === input.actorUserId),
      ),
    abandonStale: (input) =>
      run(input, (tx) =>
        cancelUnfinished(
          tx,
          ids,
          input,
          staleFor(input),
          // سلطة المالك بعد قفل الصف بالظبط: DENY اتسجل وإحنا مستنيين القفل بيرفض الإلغاء (P1).
          (lockedTx) =>
            authorityAllows(lockedTx, input.companyId, input.actorUserId).then(
              (allowed) => !allowed,
            ),
        ),
      ),
    complete: (input) => run(input, (tx) => completeInvitation(tx, ids, input)),
    claimLink: (input) => run(input, (tx) => claimLink(tx, input)),
    claimReissue: (input) => run(input, (tx) => reissueClaim(tx, ids, input)),
    stampLink: (input) => run(input, (tx) => stampIssuedLink(tx, ids, input)),
  };
}
