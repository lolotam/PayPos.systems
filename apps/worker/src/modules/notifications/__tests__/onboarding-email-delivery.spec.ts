import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
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

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { EMAIL_ENV, NOW, notificationHarness } from './harness.ts';

const STAFF_EMAIL = 'cashier@example.test';
const PIN = '4821';
const INVITEE_EMAIL = 'invitee@example.test';
const SETUP_LINK = 'https://api.pospay.systems/reset-password/token-123?callbackURL=x';
const DAY_MS = 24 * 60 * 60 * 1000;

/** قناة بريد بتسجّل الطلب نفسه: عشان نشوف البريد الحقيقي والمعاملات وقت الإرسال. */
class RecordingChannel extends FakeChannel<EmailRequest> {
  readonly requests: EmailRequest[] = [];

  override async send(request: EmailRequest): Promise<ChannelResult> {
    const result = await super.send(request);
    if (result.kind !== 'expired') this.requests.push(request);
    return result;
  }
}

const key = deriveOnboardingEnvelopeKey(EMAIL_ENV.NOTIFICATION_EMAIL_HASH_KEY);

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
  channel.requests.length = 0;
});

function sealStaffPayload(expiresAtMs: number) {
  const payload: OnboardingEmailPayload = {
    kind: 'staff_welcome_pin',
    email: STAFF_EMAIL,
    pin: PIN,
    role: 'cashier',
    recipient: 'employee',
    targetMaskedEmail: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
  const placeholder = onboardingPlaceholderEmail(STAFF_EMAIL, key ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
      templateKey: STAFF_WELCOME_PIN_KEY,
      templateRevision: 1,
      placeholderEmail: placeholder,
    }),
  };
}

function sealInvitationPayload(expiresAtMs: number) {
  const payload: OnboardingEmailPayload = {
    kind: 'member_invitation',
    email: INVITEE_EMAIL,
    link: SETUP_LINK,
    role: 'accountant',
    recipient: 'invitee',
    targetMaskedEmail: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  };
  const placeholder = onboardingPlaceholderEmail(INVITEE_EMAIL, key ?? Buffer.alloc(0)) ?? '';
  return {
    payload,
    placeholder,
    parameters: sealOnboardingEmailEnvelope(key ?? Buffer.alloc(0), payload, {
      companyId: TENANT.A.company,
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

it('authorizes the sealed staff welcome email with the placeholder address only', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const { id } = await requestOnboarding('StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({
    status: 'PENDING',
    channel: 'email',
    recipient_email: placeholder,
  });
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
  expect(attempt).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('suppresses a blocked onboarding recipient cleanly without exposing the destination', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  h.suppress();
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
