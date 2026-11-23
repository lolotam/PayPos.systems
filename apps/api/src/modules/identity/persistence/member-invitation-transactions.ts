import {
  canonicalOwnerSql,
  SYSTEM_ROLES,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import { MEMBER_INVITED, type MemberInvited } from '../events/published.ts';
import {
  MemberInvitationError,
  type CompleteInvitationInput,
  type InvitationScope,
  type MemberInvitationRow,
  type MemberInvitationTransactions,
  type OpenInvitationInput,
} from '../ports/member-invitations.port.ts';

const INVITATION_PERMISSION = 'manage:memberships:company';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

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
    open: async (input: OpenInvitationInput) => {
      await db.withTenant(
        input.companyId,
        async (tx) => {
          if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) {
            throw new MemberInvitationError('FORBIDDEN');
          }
          if (!(await scopeBelongs(tx, input.companyId, input.scope))) {
            throw new MemberInvitationError('MEMBER_ROLE_NOT_INVITABLE');
          }
          if (
            input.existingUserId !== null &&
            (await hasActiveMembership(tx, input.companyId, input.existingUserId))
          ) {
            throw new MemberInvitationError('MEMBER_ALREADY_IN_COMPANY');
          }
          try {
            await tx.execute(sql`
              INSERT INTO member_invitations
                (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, created_at)
              VALUES (${input.companyId}, ${input.invitationId}, ${input.emailHash}, ${input.roleCode},
                      ${input.scope.type}, ${input.scope.id}, ${input.actorUserId}, 'PENDING', ${input.now})`);
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            throw new MemberInvitationError('MEMBER_INVITATION_EXISTS');
          }
        },
        { userId: input.actorUserId },
      );
    },

    complete: async (input: CompleteInvitationInput) =>
      db.withTenant(
        input.companyId,
        async (tx) => {
          if (await hasActiveMembership(tx, input.companyId, input.userId)) {
            await tx.execute(sql`
              UPDATE member_invitations SET state = 'CANCELLED'
              WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
            return { ok: false };
          }
          const roleId = SYSTEM_ROLES.find((role) => role.code === input.roleCode)?.id;
          if (roleId === undefined) throw new MemberInvitationError('MEMBER_ROLE_NOT_INVITABLE');
          await tx.execute(sql`
            INSERT INTO memberships
              (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
            VALUES (${input.companyId}, ${input.membershipId}, ${input.userId}, ${roleId}::uuid, 'global',
                    ${input.scope.type}, ${input.scope.id}, ${input.now})`);
          const state = input.createdByInvitation ? 'PENDING' : 'ACTIVE';
          await tx.execute(sql`
            UPDATE member_invitations
            SET user_id = ${input.userId}, membership_id = ${input.membershipId}, state = ${state}
            WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
          const writers = transactionWriters(tx, ids);
          if (input.createdByInvitation) {
            await writers.audit.record({
              entity: 'member_invitation',
              entityId: input.invitationId,
              action: 'user.created',
              after: { user_id: input.userId, invitation_id: input.invitationId },
            });
          }
          await writers.audit.record({
            entity: 'membership',
            entityId: input.membershipId,
            action: 'created',
            after: {
              membership_id: input.membershipId,
              user_id: input.userId,
              role_code: input.roleCode,
              scope_type: input.scope.type,
              scope_id: input.scope.id,
            },
          });
          const payload: MemberInvited = {
            invitation_id: input.invitationId,
            user_id: input.userId,
            membership_id: input.membershipId,
            role_code: input.roleCode,
            scope_type: input.scope.type,
            scope_id: input.scope.id,
            invited_by: input.actorUserId,
          };
          await writers.outbox.append({
            aggregateType: 'member_invitation',
            aggregateId: input.invitationId,
            eventType: MEMBER_INVITED,
            payload,
          });
          return { ok: true };
        },
        { userId: input.actorUserId },
      ),

    read: async ({ companyId, invitationId }) =>
      db.withTenant(
        companyId,
        async (tx) => {
          const [row] = await tx.execute<{
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
          }>(sql`
            SELECT id, user_id, membership_id, role_code, scope_type, scope_id, invited_by, state,
                   link_issued_at, created_at
            FROM member_invitations WHERE company_id = ${companyId} AND id = ${invitationId}`);
          if (row === undefined) return null;
          return {
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
          } satisfies MemberInvitationRow;
        },
        { readOnly: true },
      ),

    stampLink: async ({ companyId, invitationId, at }) => {
      await db.withTenant(companyId, async (tx) => {
        await tx.execute(sql`
          UPDATE member_invitations SET link_issued_at = ${at}
          WHERE company_id = ${companyId} AND id = ${invitationId}`);
      });
    },
  };
}
