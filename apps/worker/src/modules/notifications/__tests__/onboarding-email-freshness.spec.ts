import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { MEMBER_INVITATION_KEY, STAFF_WELCOME_PIN_KEY } from '@pospay/notifications';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { SendNotification } from '../use-cases/send-notification/send-notification.ts';
import { NOW, notificationHarness } from './harness.ts';
import {
  DAY_MS,
  INVITE_ISSUED_AT,
  RecordingChannel,
  requestOnboarding,
  sealInvitationPayload,
  sealStaffPayload,
  seedActiveStaff,
  seedPendingInvitation,
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

it('refuses to send a staff PIN to a changed employee recovery_email', async () => {
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
  await h.owner`UPDATE employees SET recovery_email = 'corrected@example.test' WHERE company_id = ${TENANT.A.company} AND id = ${staff.employeeId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a queued staff welcome notice after stop and regrant changes attempt_id', async () => {
  const staff = await seedActiveStaff(h);
  const nextAttemptId = systemUuidV7().newId();
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
  await h.owner`UPDATE employee_staff_access SET attempt_id = ${nextAttemptId}, state = 'ACTIVE' WHERE company_id = ${TENANT.A.company} AND id = ${staff.accessId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a queued staff welcome notice after PIN reset rotates cashier_pins.id on the same grant', async () => {
  const staff = await seedActiveStaff(h);
  const nextPinRevision = systemUuidV7().newId();
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
  await h.owner`UPDATE cashier_pins SET id = ${nextPinRevision} WHERE company_id = ${TENANT.A.company} AND user_id = ${staff.userId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('fails closed when staff access or invitation records are missing', async () => {
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const staffMissing = sealStaffPayload(expiresAtMs, {
    employeeId: systemUuidV7().newId(),
    operationId: systemUuidV7().newId(),
  });
  const s = await requestOnboarding(h, 'StaffWelcomePinNoticeRequested', {
    channel: 'email',
    email: staffMissing.placeholder,
    locale: 'ar',
    template_key: STAFF_WELCOME_PIN_KEY,
    template_revision: 1,
    safe_parameters: staffMissing.parameters,
    send_deadline: new Date(expiresAtMs).toISOString(),
  });
  await h.module.process({ data: { company_id: s.event.companyId, attempt_id: s.id } });
  expect(await h.read(s.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  const invMissing = sealInvitationPayload(NOW.getTime() + 2 * DAY_MS, {
    invitationId: systemUuidV7().newId(),
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  const inv = await requestOnboarding(h, 'MemberInvitationNoticeRequested', {
    channel: 'email',
    email: invMissing.placeholder,
    locale: 'ar',
    template_key: MEMBER_INVITATION_KEY,
    template_revision: 1,
    safe_parameters: invMissing.parameters,
    send_deadline: new Date(NOW.getTime() + 2 * DAY_MS).toISOString(),
  });
  await h.module.process({ data: { company_id: inv.event.companyId, attempt_id: inv.id } });
  expect(await h.read(inv.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('retries transient pre-claim verification errors automatically and delivers once without leaving SENDING', async () => {
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
  const base = h.module.send;
  let verifyCalls = 0;
  let reserved = false;
  const sendWithTransientVerify = new SendNotification(
    base.attempts,
    base.channel,
    {
      reserve: async (hash, deadline) => {
        reserved = true;
        return base.admission.reserve(hash, deadline);
      },
    },
    base.identity,
    {
      ...base.configuration,
      verify: async (attempt, scope) => {
        expect(reserved).toBe(true);
        verifyCalls += 1;
        if (verifyCalls === 1) throw new Error('TRANSIENT_FRESHNESS_READ_FAILURE');
        return base.configuration.verify?.(attempt, scope) ?? true;
      },
    },
    base.clock,
    base.ids,
  );
  await sendWithTransientVerify.execute(event.companyId, id);
  expect(verifyCalls).toBe(2);
  expect(await h.read(id)).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(channel.requests).toHaveLength(1);
});

it('leaves attempt PENDING without claiming SENDING when bounded pre-claim freshness retries all throw', async () => {
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
  const base = h.module.send;
  let verifyCalls = 0;
  const sendWithFailingVerify = new SendNotification(
    base.attempts,
    base.channel,
    base.admission,
    base.identity,
    {
      ...base.configuration,
      verify: async () => {
        verifyCalls += 1;
        throw new Error('TRANSIENT_FRESHNESS_READ_FAILURE');
      },
    },
    base.clock,
    base.ids,
  );
  await expect(sendWithFailingVerify.execute(event.companyId, id)).rejects.toThrow(
    'NOTIFICATION_PERSISTENCE_FAILED',
  );
  expect(verifyCalls).toBe(3);
  expect(await h.read(id)).toMatchObject({ status: 'PENDING', execution_id: null });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a superseded member invitation link after reissue', async () => {
  const invitationId = await seedPendingInvitation(h, INVITE_ISSUED_AT);
  const reissuedAt = new Date('2026-10-01T10:05:00.000Z');
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
  await h.owner`UPDATE member_invitations SET link_issued_at = ${reissuedAt.toISOString()}::timestamptz WHERE company_id = ${TENANT.A.company} AND id = ${invitationId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});
