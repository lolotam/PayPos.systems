import { SYSTEM_ROLES, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type OverrideTerms,
} from '../domain/permission-edit.ts';
import { overrideLifecycleFailure } from '../domain/permission-override-lifecycle.ts';
import type {
  CompleteInvitationInput,
  InvitedMembership,
  MemberInvitationRefusal,
} from '../ports/member-invitations.port.ts';
import { toRow, type InvitationRecord } from './member-invitation-records.ts';
import { permissionEditorContext } from './permission-editor-context.ts';

/** قرار استثناء محفوظ على عضوية: معرّفه وأثره ونهاية مدته. */
interface SavedDecision extends Record<string, unknown> {
  readonly id: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly expires_at: string | null;
}

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
  for (const terms of input.permissionOverrides) {
    await applyOverride(tx, ids, input, memberships, terms);
  }
}

/**
 * ترتيب العضويات المرشحة للاستثناء: اللي نطاقها يطابق نطاق الاستثناء الأول، وبعدها الأساسية،
 * وبعدها الباقي — عشان أول تطابق هو اللي بيتقبل.
 */
function orderedCandidates(
  memberships: readonly InvitedMembership[],
  terms: OverrideTerms,
): InvitedMembership[] {
  const matching = memberships.filter(
    (membership) =>
      membership.scopeType === terms.scope_type && membership.scopeId === terms.scope_id,
  );
  return [...matching, ...memberships.filter((membership) => !matching.includes(membership))];
}

/**
 * الاستثناء بيتقيّم على كل عضوية مرشحة: إما التعديل مسموح ودورة القرار مسموحة، أو رفض.
 * الرفض بيرجع من العضوية الأساسية عشان يبقى سبب الرفض واحد مهما كان الترتيب.
 */
async function applyOverride(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  memberships: readonly InvitedMembership[],
  terms: OverrideTerms,
): Promise<void> {
  const primary = memberships[0];
  let primaryRefusal: MemberInvitationRefusal | null = null;
  for (const candidate of orderedCandidates(memberships, terms)) {
    const context = await permissionEditorContext(
      tx,
      input.companyId,
      input.actorUserId,
      candidate.membershipId,
      terms,
    );
    const failure = permissionEditFailure(terms, context, 'SAVE');
    if (failure === null) {
      const previous = await currentOverrides(
        tx,
        input.companyId,
        candidate.membershipId,
        terms,
        context.now,
      );
      const lifecycle = overrideLifecycleFailure(
        'SAVE',
        previous,
        permissionHolderIsOwner(context),
        context.now,
      );
      if (lifecycle === null) {
        await writeOverride(tx, ids, input, candidate.membershipId, terms, previous, context.now);
        return;
      }
      if (candidate.membershipId === primary?.membershipId) primaryRefusal = lifecycle;
      continue;
    }
    if (candidate.membershipId === primary?.membershipId) primaryRefusal = failure;
  }
  throw new InvitationRefusedError(primaryRefusal ?? 'PERMISSION_NOT_HELD');
}

/** القرارات السارية على نفس المفتاح، مقفولة، عشان المستبدل ينهي القديم بدل ما يتكدّس. */
async function currentOverrides(
  tx: Tx,
  companyId: string,
  membershipId: string,
  terms: OverrideTerms,
  now: Date,
): Promise<readonly SavedDecision[]> {
  const rows = await tx.execute<SavedDecision>(sql`
    SELECT id, effect, to_json(expires_at) #>> '{}' AS expires_at FROM permission_overrides
    WHERE company_id = ${companyId} AND membership_id = ${membershipId}
      AND permission_code = ${terms.permission_code} AND scope_type = ${terms.scope_type}
      AND scope_id = ${terms.scope_id}
      AND (expires_at IS NULL OR expires_at > ${now.toISOString()}::timestamptz)
    ORDER BY id FOR UPDATE`);
  return Array.from(rows);
}

/** كتابة الاستثناء: إنهاء القديم ثم إضافة الجديد مع تدقيق «ممنوح» أو «مستبدل». */
async function writeOverride(
  tx: Tx,
  ids: IdGenerator,
  input: CompleteInvitationInput,
  membershipId: string,
  terms: OverrideTerms,
  previous: readonly SavedDecision[],
  now: Date,
): Promise<void> {
  for (const row of previous) {
    await tx.execute(sql`
      UPDATE permission_overrides SET expires_at = ${now.toISOString()}::timestamptz
      WHERE company_id = ${input.companyId} AND id = ${row.id}`);
  }
  const id = ids.newId();
  await tx.execute(sql`
    INSERT INTO permission_overrides
      (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason,
       granted_by, granted_at, expires_at)
    VALUES (${input.companyId}, ${id}, ${membershipId}, ${terms.permission_code}, ${terms.effect},
      ${terms.scope_type}, ${terms.scope_id}, ${terms.reason}, ${input.actorUserId},
      ${now.toISOString()}::timestamptz, ${terms.expires_at}::timestamptz)`);
  await transactionWriters(tx, ids).audit.record({
    entity: 'permission_override',
    entityId: id,
    action: previous.length === 0 ? 'permission.granted' : 'permission.replaced',
    before:
      previous.length === 0
        ? null
        : previous.map((row) => ({ ...row, membership_id: membershipId })),
    after: { ...terms, membership_id: membershipId },
  });
}
