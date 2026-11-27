import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { notificationRequest } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import {
  createEmailIdentity,
  deriveOnboardingEnvelopeKey,
  FakeChannel,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  readEmailConfiguration,
  sealOnboardingEmailEnvelope,
  STAFF_WELCOME_PIN_KEY,
  type ChannelResult,
  type EmailRequest,
  type OnboardingEmailPayload,
} from '@pospay/notifications';

import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createNotificationModule } from '../notifications.module.ts';
import { EMAIL_ENV, NOW, notificationHarness } from './harness.ts';

const STAFF_EMAIL = 'cashier@example.test';
const PIN = '4821';
const INVITEE_EMAIL = 'invitee@example.test';
const SETUP_LINK = 'https://api.pospay.systems/reset-password/token-123?callbackURL=x';
const DAY_MS = 24 * 60 * 60 * 1000;
const OP_STAFF = '1f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a31';
const OP_INVITE = '2f6c5d3a-2b1e-4a77-9d10-5b8e7c1d2a32';

/** قناة بريد بتسجّل الطلب نفسه: عشان نشوف البريد الحقيقي والمعاملات وقت الإرسال. */
class RecordingChannel extends FakeChannel<EmailRequest> {
  readonly requests: EmailRequest[] = [];

  override async send(request: EmailRequest): Promise<ChannelResult> {
    const result = await super.send(request);
    if (result.kind !== 'expired') this.requests.push(request);
    return result;
  }
}

const key = deriveOnboardingEnvelopeKey(EMAIL_ENV.ONBOARDING_EMAIL_ENVELOPE_KEY);
const emailIdentity = createEmailIdentity(
  EMAIL_ENV.NOTIFICATION_EMAIL_HASH_KEY,
  EMAIL_ENV.NOTIFICATION_EMAIL_HASH_KEY_ID,
);

let h: Awaited<ReturnType<typeof notificationHarness>>;
let channel: RecordingChannel;

beforeAll(async () => {
  h = await notificationHarness({
    emailChannel: (now) => {
      channel = new RecordingChannel(now);
      return channel;
    },
  });
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  h.advance(NOW);
  h.clearSuppressions();
  channel.requests.length = 0;
});

function sealStaffPayload(
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
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
    ...extra,
  };
  const operationId = extra.operationId ?? OP_STAFF;
  const placeholder = onboardingPlaceholderEmail(STAFF_EMAIL, key ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
      operationId,
      templateKey: STAFF_WELCOME_PIN_KEY,
      templateRevision: 1,
      placeholderEmail: placeholder,
    }),
  };
}

function sealInvitationPayload(
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
  const placeholder = onboardingPlaceholderEmail(INVITEE_EMAIL, key ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
      operationId,
      templateKey: MEMBER_INVITATION_KEY,
      templateRevision: 1,
      placeholderEmail: placeholder,
    }),
  };
}

async function requestOnboarding(
  eventType: string,
  recipient: Record<string, unknown>,
): Promise<{ id: string; event: Awaited<ReturnType<typeof h.request>> }> {
  const event = await h.request(recipient, TENANT.A.company, eventType);
  await h.deliver(event);
  return { id: await h.attempt(event), event };
}

it('authorizes the sealed staff welcome email with the placeholder address and real recipient hash', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const recipient = {
    channel: 'email' as const,
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  };
  expect(
    notificationRequest.safeParse({
      business_id: null,
      branch_id: null,
      notification_recipients: [recipient],
    }).success,
  ).toBe(true);
  const { id } = await requestOnboarding('StaffWelcomePinNoticeRequested', recipient);
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({
    status: 'PENDING',
    channel: 'email',
    recipient_email: placeholder,
  });
  expect(Buffer.from(attempt?.['recipient_hash'] as Uint8Array)).toEqual(
    Buffer.from(emailIdentity.identify(STAFF_EMAIL).hash),
  );
  expect(Buffer.from(attempt?.['recipient_hash'] as Uint8Array)).not.toEqual(
    Buffer.from(emailIdentity.identify(placeholder).hash),
  );
  expect(JSON.stringify(attempt)).not.toContain(PIN);
  expect(JSON.stringify(attempt)).not.toContain(STAFF_EMAIL);
});

it('sends the sealed staff welcome email to the real address with the PIN in memory only', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const { id, event } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(channel.requests).toHaveLength(1);
  expect(channel.requests[0]?.email).toBe(STAFF_EMAIL);
  expect(JSON.stringify(channel.requests[0]?.safeParameters)).toContain(PIN);
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(JSON.stringify(attempt)).not.toContain(PIN);
  expect(JSON.stringify(attempt)).not.toContain(STAFF_EMAIL);
});

it('sends the sealed member invitation email with the setup link', async () => {
  const expiresAtMs = NOW.getTime() + 48 * 60 * 60 * 1000;
  const { placeholder, parameters } = sealInvitationPayload(expiresAtMs);
  const { id, event } = await requestOnboarding('MemberInvitationNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: MEMBER_INVITATION_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(channel.requests).toHaveLength(1);
  expect(channel.requests[0]?.email).toBe(INVITEE_EMAIL);
  expect(JSON.stringify(channel.requests[0]?.safeParameters)).toContain('token-123');
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(JSON.stringify(attempt)).not.toContain('token-123');
  expect(JSON.stringify(attempt)).not.toContain(INVITEE_EMAIL);
});

it('refuses a tampered envelope instead of sending anything', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const tampered = parameters.map((parameter, index) =>
    index === 0 ? { ...parameter, value: `${parameter.value.slice(0, -2)}xy` } : parameter,
  );
  const { id, event } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: tampered,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'PARAMETERS_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses an expired envelope instead of sending anything', async () => {
  const expiresAtMs = NOW.getTime() + 1000;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const { id, event } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(NOW.getTime() + DAY_MS).toISOString(),
  });
  h.advance(new Date(NOW.getTime() + 2000));
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'PARAMETERS_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('suppresses by the real email hash without touching the placeholder hash', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  h.suppressHash(emailIdentity.identify(STAFF_EMAIL).hash);
  const { id, event } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'SUPPRESSED', recipient_email: null });
  expect(channel.requests).toHaveLength(0);
});

it('records CONFIG_INVALID when worker email hash config is incomplete instead of aborting outbox', async () => {
  const broken = createNotificationModule({
    database: h.db,
    ids: systemUuidV7(),
    clock: h.clock,
    channel: h.channel,
    production: false,
    configuration: {
      mode: 'fake',
      hashKey: 'test-key-not-a-secret'.repeat(3),
      hashKeyId: 'test-v1',
    },
    emailConfiguration: readEmailConfiguration({
      ...EMAIL_ENV,
      NOTIFICATION_EMAIL_HASH_KEY_ID: '',
    }),
    emailEnvelopeKey: EMAIL_ENV.ONBOARDING_EMAIL_ENVELOPE_KEY,
    emailTesting: { channel },
  });
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const event = await h.request(
    {
      channel: 'email',
      email: placeholder,
      locale: 'ar',
      template_key: STAFF_WELCOME_PIN_KEY,
      template_revision: 1,
      safe_parameters: parameters,
      send_deadline: new Date(expiresAtMs).toISOString(),
    },
    TENANT.A.company,
    'StaffWelcomePinNoticeRequested',
  );
  await h.db.withTenant(event.companyId, (tx) => broken.consumer.handle(tx, event));
  const attempt = await h.read(await h.attempt(event));
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'CONFIG_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses to send a staff PIN to a changed employee recovery_email', async () => {
  const employeeId = systemUuidV7().newId();
  await h.owner`
    INSERT INTO employees (company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date, employee_number, recovery_email)
    VALUES (${TENANT.A.company}, ${employeeId}, ${TENANT.A.business}, ${TENANT.A.branch}, 'Sara', 'sara', 'staff', '2026-10-01', 9901, ${STAFF_EMAIL})`;
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs, {
    employeeId,
    operationId: OP_STAFF,
  });
  const { id, event } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.owner`UPDATE employees SET recovery_email = 'corrected@example.test' WHERE company_id = ${TENANT.A.company} AND id = ${employeeId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a superseded member invitation link after reissue', async () => {
  const invitationId = systemUuidV7().newId();
  const initialIssued = new Date('2026-10-01T10:00:00.000Z');
  const reissuedAt = new Date('2026-10-01T10:05:00.000Z');
  await h.owner`
    INSERT INTO "user" (id, name, email, email_verified)
    VALUES (${USER}, 'Owner', 'owner@example.test', true)
    ON CONFLICT (id) DO NOTHING`;
  await h.owner`
    INSERT INTO member_invitations (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, link_issued_at)
    VALUES (${TENANT.A.company}, ${invitationId}, ${'a'.repeat(64)}, 'accountant', 'COMPANY', ${TENANT.A.company}, ${USER}, 'PENDING', ${initialIssued.toISOString()}::timestamptz)`;
  const expiresAtMs = NOW.getTime() + 48 * 60 * 60 * 1000;
  const { placeholder, parameters } = sealInvitationPayload(expiresAtMs, {
    invitationId,
    issuedAt: initialIssued.toISOString(),
  });
  const { id, event } = await requestOnboarding('MemberInvitationNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: MEMBER_INVITATION_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.owner`UPDATE member_invitations SET link_issued_at = ${reissuedAt.toISOString()}::timestamptz WHERE company_id = ${TENANT.A.company} AND id = ${invitationId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});
