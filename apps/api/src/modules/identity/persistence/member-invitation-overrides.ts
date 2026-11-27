import { SYSTEM_ROLES, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type OverrideTerms,
} from '../domain/permission-edit.ts';
import { orderOverrideCandidateMemberships } from '../domain/inline-override-candidates.ts';
import { overrideLifecycleFailure } from '../domain/permission-override-lifecycle.ts';
import type {
  CompleteInvitationInput,
  InvitedMembership,
  MemberInvitationRefusal,
} from '../ports/member-invitations.port.ts';
import { toRow, type InvitationRecord } from './member-invitation-records.ts';
import { permissionEditorBatch } from './permission-editor-context.ts';
import { currentOverrides, writeOverride } from './permission-override-writer.ts';

/** رفض جوّه معاملة الإتمام: بيرمي عشان الكتابة كلها تتراجع، وبيتحول لـ refusal بعد الـ rollback. */
export class InvitationRefusedError extends Error {
  constructor(readonly refusal: MemberInvitationRefusal) {
    super(refusal);
    this.name = 'InvitationRefusedError';
  }
}

/**
 * العضوية الأساسية والإضافية: كل واحدة صف مستقل في نفس المعاملة، وكل واحدة ليها تدقيق وحدث.
 * وقت البدء من ساعة الداتابيز نفسها عشان العضوية تبقى سارية فوراً مهما كان فرق الساعة بين
 * التطبيق والداتابيز.
 */
export async function writeInvitationMemberships(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  invitation: InvitationRecord,
): Promise<InvitedMembership[]> {
  const row = toRow(invitation);
  const memberships: InvitedMembership[] = [
    {
      membershipId: input.membershipId,
      roleCode: row.roleCode,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
    },
    ...input.additionalAssignments.map((assignment, index) => {
      const membershipId = input.additionalMembershipIds[index];
      if (membershipId === undefined) {
        throw new Error('member invitation additionalMembershipIds length mismatch');
      }
      return {
        membershipId,
        roleCode: assignment.role,
        scopeType: assignment.scope.type,
        scopeId: assignment.scope.id,
      };
    }),
  ];
  for (const membership of memberships) {
    // كود الدور جاي من الصف المقفول أو من دور إضافي متحقق منه في الدومين؛ لو مش من أدوار النظام ده كسر ثابت في الجدول (500).
    const roleId = SYSTEM_ROLES.find((role) => role.code === membership.roleCode)?.id;
    if (roleId === undefined) {
      throw new Error(`member invitation role ${membership.roleCode} is not a system role`);
    }
    await tx.execute(sql`
      INSERT INTO memberships
        (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
      VALUES (${input.companyId}, ${membership.membershipId}, ${input.userId}, ${roleId}::uuid,
              'global', ${membership.scopeType}, ${membership.scopeId}, clock_timestamp())`);
  }
  await tx.execute(sql`
    UPDATE member_invitations
    SET user_id = ${input.userId}, membership_id = ${input.membershipId}
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  const writers = transactionWriters(tx, ids);
  for (const entry of input.buildAudit(row, memberships, input.userId)) {
    await writers.audit.record(entry);
  }
  for (const membership of memberships) {
    await writers.outbox.append(input.buildEvent(row, membership, input.userId));
  }
  return memberships;
}

/**
 * استثناءات الصلاحية المضمّنة («استثناء صلاحية»): كل واحد بيتكتب على أقرب عضوية صالحة له،
 * وأول استثناء مرفوض بيرمي عشان كل الكتابة تتراجع — الدعوة كلها ما تبقاش نص مكتوب.
 */
export async function applyInvitationOverrides(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  memberships: readonly InvitedMembership[],
): Promise<void> {
  if (input.permissionOverrides.length === 0) return;
  const primary = memberships[0];
  if (primary === undefined) throw new InvitationRefusedError('PERMISSION_NOT_HELD');
  const batch = await permissionEditorBatch(
    tx,
    input.companyId,
    input.actorUserId,
    primary.membershipId,
  );
  for (const terms of input.permissionOverrides) {
    await applyOverride(tx, ids, input, memberships, batch, terms);
  }
}

/**
 * الاستثناء بيتقيّم على كل عضوية مرشحة: إما التعديل مسموح ودورة القرار مسموحة، أو رفض.
 * الرفض بيرجع من العضوية الأساسية عشان يبقى سبب الرفض واحد مهما كان الترتيب.
 *
 * معرّف النطاق بيتطبّع لحروف صغيرة قبل أي مقارنة: UUID مش حساس لحالة الأحرف، فالنطاق
 * المكتوب بحرف كبير لازم يتعامل زي نفس النطاق المكتوب بحرف صغير.
 */
async function applyOverride(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  memberships: readonly InvitedMembership[],
  batch: Awaited<ReturnType<typeof permissionEditorBatch>>,
  terms: OverrideTerms,
): Promise<void> {
  const primary = memberships[0];
  const canonicalTerms: OverrideTerms = { ...terms, scope_id: terms.scope_id.toLowerCase() };
  let primaryRefusal: MemberInvitationRefusal | null = null;
  for (const candidate of orderOverrideCandidateMemberships(memberships, canonicalTerms)) {
    const context = await batch.forCandidate(candidate.membershipId, canonicalTerms);
    const failure = permissionEditFailure(canonicalTerms, context, 'SAVE');
    if (failure === null) {
      const previous = await currentOverrides(
        tx,
        input.companyId,
        candidate.membershipId,
        canonicalTerms,
        context.now,
      );
      const lifecycle = overrideLifecycleFailure(
        'SAVE',
        previous,
        permissionHolderIsOwner(context),
        context.now,
      );
      if (lifecycle === null) {
        await writeOverride(
          tx,
          ids,
          input,
          candidate.membershipId,
          canonicalTerms,
          previous,
          context.now,
        );
        return;
      }
      if (candidate.membershipId === primary?.membershipId) primaryRefusal = lifecycle;
      continue;
    }
    if (candidate.membershipId === primary?.membershipId) primaryRefusal = failure;
  }
  throw new InvitationRefusedError(primaryRefusal ?? 'PERMISSION_NOT_HELD');
}
