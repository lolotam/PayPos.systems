import { systemUuidV7 } from '@pospay/ids';
import {
  createEmailIdentity,
  deriveOnboardingEnvelopeKey,
  FakeChannel,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  sealOnboardingEmailEnvelope,
  STAFF_WELCOME_PIN_KEY,
  type ChannelResult,
  type EmailRequest,
  type OnboardingEmailPayload,
} from '@pospay/notifications';

import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { EMAIL_ENV, type notificationHarness } from './harness.ts';

export const STAFF_EMAIL = 'cashier@example.test';
export const PIN = '4821';
export const INVITEE_EMAIL = 'invitee@example.test';
export const SETUP_LINK = 'https://api.pospay.systems/reset-password/token-123?callbackURL=x';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_ISSUED_AT = new Date('2026-10-01T09:55:00.000Z');
export const OP_STAFF = '1f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a31';
export const OP_INVITE = '2f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a32';
export const PIN_REVISION = '3f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a33';

let nextEmployeeNumber = 9900;

/** قناة بريد بتسجّل الطلب نفسه: عشان نشوف البريد الحقيقي والمعاملات وقت الإرسال. */
export class RecordingChannel extends FakeChannel<EmailRequest> {
  readonly requests: EmailRequest[] = [];

  override async send(request: EmailRequest): Promise<ChannelResult> {
    const result = await super.send(request);
    if (result.kind !== 'expired') this.requests.push(request);
    return result;
  }
}

export const envelopeKey = deriveOnboardingEnvelopeKey(EMAIL_ENV.ONBOARDING_EMAIL_ENVELOPE_KEY);
export const onboardingEmailIdentity = createEmailIdentity(
  EMAIL_ENV.NOTIFICATION_EMAIL_HASH_KEY,
  EMAIL_ENV.NOTIFICATION_EMAIL_HASH_KEY_ID,
);

export type OnboardingHarness = Awaited<ReturnType<typeof notificationHarness>>;

export function sealStaffPayload(
  expiresAtMs: number,
  extra: Partial<Extract<OnboardingEmailPayload, { kind: 'staff_welcome_pin' }>> = {},
) {
  const payload: OnboardingEmailPayload = {
    kind: 'staff_welcome_pin',
    email: STAFF_EMAIL,
    pin: PIN,
    role: 'cashier',
    recipient: 'employee',
    targetMaskedEmail: null,
    pinRevision: PIN_REVISION,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    ...extra,
  };
  const operationId = extra.operationId ?? OP_STAFF;
  const placeholder =
    onboardingPlaceholderEmail(payload.email, envelopeKey ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(envelopeKey ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
      operationId,
      templateKey: STAFF_WELCOME_PIN_KEY,
      templateRevision: 1,
      placeholderEmail: placeholder,
    }),
  };
}

export function sealInvitationPayload(
  expiresAtMs: number,
  extra: Partial<Extract<OnboardingEmailPayload, { kind: 'member_invitation' }>> = {},
) {
  const payload: OnboardingEmailPayload = {
    kind: 'member_invitation',
    email: INVITEE_EMAIL,
    link: SETUP_LINK,
    role: 'accountant',
    recipient: 'invitee',
    targetMaskedEmail: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    ...extra,
  };
  const operationId = extra.invitationId ?? OP_INVITE;
  const placeholder =
    onboardingPlaceholderEmail(INVITEE_EMAIL, envelopeKey ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(envelopeKey ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
      operationId,
      templateKey: MEMBER_INVITATION_KEY,
      templateRevision: 1,
      placeholderEmail: placeholder,
    }),
  };
}

export async function requestOnboarding(
  h: OnboardingHarness,
  eventType: string,
  recipient: Record<string, unknown>,
) {
  const event = await h.request(recipient, TENANT.A.company, eventType);
  await h.deliver(event);
  return { id: await h.attempt(event), event };
}

async function ensureSeedUser(
  h: OnboardingHarness,
  userId: string = USER,
  email = 'owner@example.test',
) {
  await h.owner`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES (${userId}, 'Seed User', ${email}, true)
    ON CONFLICT (id) DO NOTHING`;
}

export async function seedActiveStaff(h: OnboardingHarness, recoveryEmail?: string | null) {
  await ensureSeedUser(h);
  const employeeId = systemUuidV7().newId();
  const userId = systemUuidV7().newId();
  const pinRevision = systemUuidV7().newId();
  const membershipId = systemUuidV7().newId();
  const accessId = systemUuidV7().newId();
  const operationId = systemUuidV7().newId();
  const attemptId = systemUuidV7().newId();
  const empNo = ++nextEmployeeNumber;
  const email = recoveryEmail === undefined ? `cashier-${empNo}@example.test` : recoveryEmail;
  await ensureSeedUser(h, userId, `staff-${empNo}@example.test`);
  await h.owner`
    INSERT INTO employees (company_id, id, business_id, primary_branch_id, user_id, name_en, name_en_key, role_code, hire_date, employee_number, recovery_email)
    VALUES (${TENANT.A.company}, ${employeeId}, ${TENANT.A.business}, ${TENANT.A.branch}, ${userId}, ${`Emp ${empNo}`}, ${`emp${empNo}`}, 'staff', '2026-10-01', ${empNo}, ${email})`;
  await h.owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    SELECT ${TENANT.A.company}, ${membershipId}, ${userId}, id, 'global', 'BRANCH', ${TENANT.A.branch}
    FROM roles WHERE company_id IS NULL AND code = 'staff'`;
  await h.owner`
    INSERT INTO employee_staff_access (company_id, id, business_id, employee_id, operation_id, user_id, membership_id, role_code, branch_id, attempt_id, phone_hash, state, granted_by)
    VALUES (${TENANT.A.company}, ${accessId}, ${TENANT.A.business}, ${employeeId}, ${operationId}, ${userId}, ${membershipId}, 'staff', ${TENANT.A.branch}, ${attemptId}, ${empNo.toString().padStart(64, '0')}, 'ACTIVE', ${USER})`;
  await h.owner`
    INSERT INTO cashier_pins (company_id, id, user_id, pin_hash, set_by, set_at, temporary, expires_at)
    VALUES (${TENANT.A.company}, ${pinRevision}, ${userId}, 'pbkdf2-sha256$1$aa$bb', ${USER}, now(), true, now() + interval '1 day')
    ON CONFLICT (company_id, user_id) DO UPDATE SET id = EXCLUDED.id, temporary = true, expires_at = EXCLUDED.expires_at`;
  return {
    employeeId,
    userId,
    pinRevision,
    accessId,
    operationId,
    attemptId,
    email: email ?? STAFF_EMAIL,
  };
}

export async function seedPendingInvitation(
  h: OnboardingHarness,
  issuedAt: Date = INVITE_ISSUED_AT,
) {
  await ensureSeedUser(h);
  const invitationId = systemUuidV7().newId();
  const emailHash = invitationId.replaceAll('-', '').padEnd(64, 'a');
  await h.owner`
    INSERT INTO member_invitations (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, link_issued_at)
    VALUES (${TENANT.A.company}, ${invitationId}, ${emailHash}, 'accountant', 'COMPANY', ${TENANT.A.company}, ${USER}, 'PENDING', ${issuedAt.toISOString()}::timestamptz)`;
  return invitationId;
}
