import { MEMBER_INVITATION_LINK_TTL_MS } from '@pospay/auth';
import type { IdGenerator, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { OnboardingEmailSealer } from '../../../shared/ports/onboarding-email.port.ts';
import type { InvitationActor } from '../ports/member-invitations.port.ts';
import { teamAlertRecipientContacts } from './team-alert-recipient-contacts.ts';

/** صف الدعوة كما بريد الدعوة بيشوفه: المستخدم المدعو والدور والداعي. */
type InvitationNoticeRow = {
  readonly user_id: string | null;
  readonly role_code: string;
  readonly invited_by: string;
};

/** مستلم بريد الدعوة: إيميله الحقيقي ودوره في الرسالة. */
interface InvitationNoticeRecipient {
  readonly email: string;
  readonly recipient: 'invitee' | 'owner';
  readonly targetMaskedEmail: string | null;
}

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

/** يجمع مستلمي الدعوة: المدعو والداعي من غير تكرار، مع قناع إيميل المدعو للداعي. */
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
  readonly recipients: readonly InvitationNoticeRecipient[];
} | null> {
  const [row] = await tx.execute<InvitationNoticeRow>(sql`
    SELECT user_id, role_code, invited_by FROM member_invitations
    WHERE company_id = ${input.companyId} AND id = ${input.invitationId}`);
  const inviteeUserId = row?.user_id ?? input.userId;
  if (row === undefined || inviteeUserId === undefined || inviteeUserId === null) return null;
  const contacts = await teamAlertRecipientContacts(
    tx,
    input.companyId,
    [inviteeUserId, input.actorUserId],
    input.at,
    { requireVerifiedEmail: false },
  );
  const inviteeEmail = contacts.get(inviteeUserId)?.email ?? input.email ?? null;
  const ownerEmail = contacts.get(input.actorUserId)?.email ?? null;
  const recipients: InvitationNoticeRecipient[] = [];
  if (inviteeEmail !== null)
    recipients.push({ email: inviteeEmail, recipient: 'invitee', targetMaskedEmail: null });
  if (ownerEmail !== null && ownerEmail.trim().toLowerCase() !== inviteeEmail?.trim().toLowerCase())
    recipients.push({
      email: ownerEmail,
      recipient: 'owner',
      targetMaskedEmail: inviteeEmail === null ? null : sealer.mask(inviteeEmail),
    });
  return recipients.length === 0 ? null : { roleCode: row.role_code, recipients };
}

/** يختم مستلمي الدعوة في مظاريف صالحة للـ outbox من غير أي نص صريح. */
function sealInvitationRecipients(
  recipients: readonly InvitationNoticeRecipient[],
  companyId: string,
  link: string,
  roleCode: string,
  expiresAt: Date,
  sealer: OnboardingEmailSealer,
): SealedInvitationRecipient[] {
  const result: SealedInvitationRecipient[] = [];
  for (const recipient of recipients) {
    const sealed = sealer.sealMemberInvitation({
      companyId,
      email: recipient.email,
      payload: {
        kind: 'member_invitation',
        email: recipient.email,
        link,
        role: roleCode,
        recipient: recipient.recipient,
        targetMaskedEmail: recipient.targetMaskedEmail,
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
  const expiresAt = new Date(input.at.getTime() + MEMBER_INVITATION_LINK_TTL_MS);
  const notificationRecipients = sealInvitationRecipients(
    collected.recipients,
    input.companyId,
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
