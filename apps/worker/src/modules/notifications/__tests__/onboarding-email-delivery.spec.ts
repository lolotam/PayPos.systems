import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { notificationRequest } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import {
  MEMBER_INVITATION_KEY,
  readEmailConfiguration,
  STAFF_WELCOME_PIN_KEY,
} from '@pospay/notifications';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createNotificationModule } from '../notifications.module.ts';
import { SendNotification } from '../use-cases/send-notification/send-notification.ts';
import { EMAIL_ENV, NOW, notificationHarness } from './harness.ts';
import {
  DAY_MS,
  INVITE_ISSUED_AT,
  INVITEE_EMAIL,
  onboardingEmailIdentity,
  PIN,
  queueInvitationNotice,
  queueStaffWelcomeNotice,
  RecordingChannel,
  requestOnboarding,
  sealInvitationPayload,
  sealStaffPayload,
  seedActiveStaff,
  seedCompanyActor,
  seedPendingInvitation,
  STAFF_EMAIL,
  type OnboardingHarness,
} from './onboarding-email-harness.ts';

let h: OnboardingHarness;
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
  const { id } = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', recipient);
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({
    status: 'PENDING',
    channel: 'email',
    recipient_email: placeholder,
  });
  expect(Buffer.from(attempt?.['recipient_hash'] as Uint8Array)).toEqual(
    Buffer.from(onboardingEmailIdentity.identify(STAFF_EMAIL).hash),
  );
  expect(Buffer.from(attempt?.['recipient_hash'] as Uint8Array)).not.toEqual(
    Buffer.from(onboardingEmailIdentity.identify(placeholder).hash),
  );
  expect(JSON.stringify(attempt)).not.toContain(PIN);
  expect(JSON.stringify(attempt)).not.toContain(STAFF_EMAIL);
});

it('sends the sealed staff welcome email to the real address with the PIN in memory only', async () => {
  const staff = await seedActiveStaff(h);
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  const { id, event } = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', {
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
  expect(channel.requests[0]?.email).toBe(staff.email);
  expect(JSON.stringify(channel.requests[0]?.safeParameters)).toContain(PIN);
  const attempt = await h.read(id);
  expect(attempt).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(JSON.stringify(attempt)).not.toContain(PIN);
  expect(JSON.stringify(attempt)).not.toContain(staff.email);
});

it('sends the sealed member invitation email with the setup link', async () => {
  const invitationId = await seedPendingInvitation(h, INVITE_ISSUED_AT, undefined, INVITEE_EMAIL);
  const expiresAtMs = NOW.getTime() + 48 * 60 * 60 * 1000;
  const { placeholder, parameters } = sealInvitationPayload(expiresAtMs, {
    invitationId,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  const { id, event } = await requestOnboarding(h, 'MemberInvitationNoticeRequested', {
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
  const { id, event } = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: tampered,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'PARAMETERS_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses an expired envelope instead of sending anything', async () => {
  const expiresAtMs = NOW.getTime() + 1000;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  const { id, event } = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', {
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
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'PARAMETERS_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('suppresses by the real email hash without touching the placeholder hash', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const { placeholder, parameters } = sealStaffPayload(expiresAtMs);
  h.suppressHash(onboardingEmailIdentity.identify(STAFF_EMAIL).hash);
  const { id, event } = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'SUPPRESSED', recipient_email: null });
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
  expect(await h.read(await h.attempt(event))).toMatchObject({
    status: 'FAILED',
    failure_code: 'CONFIG_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('sends valid manager welcome and owner invitation copies when actor contacts and authority match', async () => {
  const manager = await seedCompanyActor(h, 'branch_manager', 'valid-mgr@example.test');
  const staff = await seedActiveStaff(h, null, manager.userId);
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const mgrNotice = await queueStaffWelcomeNotice(h, expiresAtMs, {
    recipient: 'manager',
    email: manager.email,
    targetMaskedEmail: 'ca***@example.test',
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  await h.module.process({
    data: { company_id: mgrNotice.event.companyId, attempt_id: mgrNotice.id },
  });
  expect(await h.read(mgrNotice.id)).toMatchObject({ status: 'SENT', recipient_email: null });

  const owner = await seedCompanyActor(h, 'owner', 'valid-owner@example.test');
  const invitationId = await seedPendingInvitation(h, INVITE_ISSUED_AT, owner.userId);
  const ownerNotice = await queueInvitationNotice(h, expiresAtMs, {
    recipient: 'owner',
    email: owner.email,
    targetMaskedEmail: 'in***@example.test',
    invitationId,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.module.process({
    data: { company_id: ownerNotice.event.companyId, attempt_id: ownerNotice.id },
  });
  expect(await h.read(ownerNotice.id)).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(channel.requests.map((request) => request.email)).toEqual([manager.email, owner.email]);
});

it('renews expired Redis admission when slow verification exceeds 1000ms and delivers once', async () => {
  const staff = await seedActiveStaff(h);
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  const base = h.module.send;
  let reserveCalls = 0;
  let verifyCalls = 0;
  const sendRenewed = new SendNotification(
    base.attempts,
    base.channel,
    {
      reserve: async () => {
        reserveCalls += 1;
        return true;
      },
    },
    base.identity,
    {
      ...base.configuration,
      verify: async (attempt, scope) => {
        verifyCalls += 1;
        const ok = await (base.configuration.verify?.(attempt, scope) ?? Promise.resolve(true));
        if (verifyCalls === 1) h.advance(new Date(NOW.getTime() + 1_500));
        return ok;
      },
    },
    base.clock,
    base.ids,
  );
  await sendRenewed.execute(event.companyId, id);
  expect(reserveCalls).toBe(2);
  expect(verifyCalls).toBe(2);
  expect(await h.read(id)).toMatchObject({ status: 'SENT' });
  expect(channel.requests).toHaveLength(1);
});

it('re-checks deadline before Redis admission on retries delayed past the 1000ms cooldown window', async () => {
  const staff = await seedActiveStaff(h);
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + 2_000, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  const base = h.module.send;
  let reserveCalls = 0;
  let verifyCalls = 0;
  const sendDelayed = new SendNotification(
    base.attempts,
    base.channel,
    {
      reserve: async () => {
        reserveCalls += 1;
        if (reserveCalls > 1) throw new Error('REDIS_SHOULD_NOT_BE_CALLED_AFTER_DEADLINE');
        return true;
      },
    },
    base.identity,
    {
      ...base.configuration,
      verify: async (attempt, scope) => {
        verifyCalls += 1;
        h.advance(new Date(NOW.getTime() + 2_500));
        if (verifyCalls === 1) throw new Error('TRANSIENT_FRESHNESS_READ_FAILURE');
        return base.configuration.verify?.(attempt, scope) ?? true;
      },
    },
    base.clock,
    base.ids,
  );
  await sendDelayed.execute(event.companyId, id);
  expect(reserveCalls).toBe(1);
  expect(await h.read(id)).toMatchObject({ status: 'EXPIRED', failure_code: 'DEADLINE_EXPIRED' });
  expect(channel.requests).toHaveLength(0);
});
