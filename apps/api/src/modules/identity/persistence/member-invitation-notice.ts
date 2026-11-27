import { MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';
import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OnboardingEmailSealer } from '../../../shared/ports/onboarding-email.port.ts';
import {
  memberInvitationLinkExpiresAt,
  selectMemberInvitationNoticeRecipients,
  type InvitationNoticeRecipientSpec,
} from '../domain/invitable-roles.ts';
import type { InvitationActor } from '../ports/member-invitations.port.ts';
import { activeMembership, authorityAllows, lockInvitation } from './member-invitation-records.ts';
import { teamAlertRecipientContacts } from './team-alert-recipient-contacts.ts';

/** عنصر مستلم واحد في حدث طلب بريد الدعوة. */
type SealedInvitationRecipient = {
  readonly channel: 'email';
  readonly email: string;
  readonly locale: string;
  readonly template_key: string;
  readonly template_revision: number;
  readonly safe_parameters: readonly {
    readonly name: string;
    readonly type: 'text';
    readonly value: string;
  }[];
  readonly send_deadline: string;
};

/** يجمع مستلمي الدعوة تحت قفل الصف والتحقق من سلطة المالك وسريان العضوية: المدعو والداعي من غير تكرار. */
async function collectInvitationRecipients(
  tx: Tx,
  input: InvitationActor & {
    invitationId: string;
    at: Date;
    userId?: string | undefined;
    email?: string | undefined;
  },
  sealer: OnboardingEmailSealer,
): Promise<{
  readonly roleCode: string;
  readonly recipients: readonly InvitationNoticeRecipientSpec[];
} | null> {
  const invitation = await lockInvitation(tx, input.companyId, input.invitationId);
  if (!(await authorityAllows(tx, input.companyId, input.actorUserId))) return null;
  if (
    invitation === undefined ||
    invitation.state !== 'PENDING' ||
    invitation.invited_by !== input.actorUserId ||
    invitation.membership_id === null ||
    invitation.user_id === null
  )
    return null;
  if (!(await activeMembership(tx, input.companyId, invitation.membership_id, invitation.user_id)))
    return null;
  // writeInvitationMemberships يكتب starts_at بـ clock_timestamp()؛ ساعة الداتابيز تمنع رفض عضو جديد بسبب فرق الساعة أو تقريب الميكروثانية.
  const [clockRow] = await tx.execute<{ db_now: string | Date }>(sql`
    SELECT GREATEST(
      date_trunc('milliseconds', clock_timestamp()) + interval '1 millisecond',
      ${input.at.toISOString()}::timestamptz
    ) AS db_now`);
  const contactAt = clockRow?.db_now !== undefined ? new Date(clockRow.db_now) : input.at;
  const contacts = await teamAlertRecipientContacts(
    tx,
    input.companyId,
    [invitation.user_id, input.actorUserId],
    contactAt,
    { requireVerifiedEmail: false },
  );
  const recipients = selectMemberInvitationNoticeRecipients({
    inviteeEmail: contacts.get(invitation.user_id)?.email ?? null,
    ownerEmail: contacts.get(input.actorUserId)?.email ?? null,
    mask: sealer.mask,
  });
  return recipients.length === 0 ? null : { roleCode: invitation.role_code, recipients };
}

/** يختم مستلمي الدعوة في مظاريف صالحة للـ outbox من غير أي نص صريح. */
function sealInvitationRecipients(
  recipients: readonly InvitationNoticeRecipientSpec[],
  companyId: string,
  invitationId: string,
  issuedAt: Date,
  link: string,
  roleCode: string,
  expiresAt: Date,
  sealer: OnboardingEmailSealer,
): SealedInvitationRecipient[] {
  const result: SealedInvitationRecipient[] = [];
  for (const recipient of recipients) {
    const sealed = sealer.sealMemberInvitation({
      companyId,
      operationId: invitationId,
      email: recipient.email,
      payload: {
        kind: 'member_invitation',
        email: recipient.email,
        link,
        role: roleCode,
        recipient: recipient.recipient,
        targetMaskedEmail: recipient.targetMaskedEmail,
        invitationId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expiresAtMs: expiresAt.getTime(),
      },
    });
    if (sealed === null) continue;
    result.push({
      channel: 'email',
      email: sealed.placeholderEmail,
      locale: 'ar',
      template_key: sealed.template.key,
      template_revision: sealed.template.revision,
      safe_parameters: sealed.parameters,
      send_deadline: expiresAt.toISOString(),
    });
  }
  return result;
}

/**
 * بريد الدعوة: المدعو والداعي، من غير تكرار — والرابط بيتختم قبل ما يوصل للـ outbox.
 *
 * @param tx     معاملة الدعوة
 * @param ids    مولّد المعرّفات
 * @param input  الفاعل ومعرف الدعوة ووقت الإصدار والمستخدم المدعو والرابط
 * @param sealer ختم إيميلات الترحيب
 */
export async function appendMemberInvitationNotice(
  tx: Tx,
  ids: IdGenerator,
  input: InvitationActor & {
    invitationId: string;
    at: Date;
    userId?: string | undefined;
    link?: string | undefined;
    email?: string | undefined;
  },
  sealer: OnboardingEmailSealer | undefined,
): Promise<void> {
  if (sealer === undefined || input.link === undefined || input.link === '') return;
  const collected = await collectInvitationRecipients(tx, input, sealer);
  if (collected === null) return;
  const expiresAt = memberInvitationLinkExpiresAt(input.at, MEMBER_INVITATION_LINK_TTL_MS);
  const notificationRecipients = sealInvitationRecipients(
    collected.recipients,
    input.companyId,
    input.invitationId,
    input.at,
    input.link,
    collected.roleCode,
    expiresAt,
    sealer,
  );
  if (notificationRecipients.length === 0) return;
  await transactionWriters(tx, ids).outbox.append({
    aggregateType: 'member_invitation',
    aggregateId: input.invitationId,
    eventType: 'MemberInvitationNoticeRequested',
    payload: {
      business_id: null,
      branch_id: null,
      notification_recipients: notificationRecipients,
    },
  });
}
