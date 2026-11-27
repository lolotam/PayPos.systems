import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { SendNotification } from '../use-cases/send-notification/send-notification.ts';
import { NOW, notificationHarness } from './harness.ts';
import {
  DAY_MS,
  INVITE_ISSUED_AT,
  queueInvitationNotice,
  queueStaffWelcomeNotice,
  RecordingChannel,
  seedActiveStaff,
  seedCompanyActor,
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
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  await h.owner`UPDATE employees SET recovery_email = 'corrected@example.test' WHERE company_id = ${TENANT.A.company} AND id = ${staff.employeeId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a queued staff welcome notice after stop and regrant changes attempt_id', async () => {
  const staff = await seedActiveStaff(h);
  const nextAttemptId = systemUuidV7().newId();
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  await h.owner`UPDATE employee_staff_access SET attempt_id = ${nextAttemptId}, state = 'ACTIVE' WHERE company_id = ${TENANT.A.company} AND id = ${staff.accessId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a queued staff welcome notice after PIN reset rotates cashier_pins.id on the same grant', async () => {
  const staff = await seedActiveStaff(h);
  const nextPinRevision = systemUuidV7().newId();
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  await h.owner`UPDATE cashier_pins SET id = ${nextPinRevision} WHERE company_id = ${TENANT.A.company} AND user_id = ${staff.userId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('fails closed when staff access or invitation records are missing', async () => {
  const s = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    employeeId: systemUuidV7().newId(),
    operationId: systemUuidV7().newId(),
  });
  await h.module.process({ data: { company_id: s.event.companyId, attempt_id: s.id } });
  expect(await h.read(s.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  const inv = await queueInvitationNotice(h, NOW.getTime() + 2 * DAY_MS, {
    invitationId: systemUuidV7().newId(),
    issuedAt: INVITE_ISSUED_AT.toISOString(),
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
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
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
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
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
  const inviteeEmail = 'reissued-invitee@example.test';
  const invitationId = await seedPendingInvitation(h, INVITE_ISSUED_AT, undefined, inviteeEmail);
  const reissuedAt = new Date('2026-10-01T10:05:00.000Z');
  const { id, event } = await queueInvitationNotice(h, NOW.getTime() + 48 * 60 * 60 * 1000, {
    email: inviteeEmail,
    invitationId,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.owner`UPDATE member_invitations SET link_issued_at = ${reissuedAt.toISOString()}::timestamptz WHERE company_id = ${TENANT.A.company} AND id = ${invitationId}`;
  await h.module.process({ data: { company_id: event.companyId, attempt_id: id } });
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'DESTINATION_INVALID' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a case-only local-part address mismatch on recovery email and user contact', async () => {
  const staff = await seedActiveStaff(h, 'cashier-case@example.test');
  const staffNotice = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    email: 'Cashier-Case@example.test',
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  await h.module.process({
    data: { company_id: staffNotice.event.companyId, attempt_id: staffNotice.id },
  });
  expect(await h.read(staffNotice.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });

  const actor = await seedCompanyActor(h, 'branch_manager', 'Case-Mgr@example.test');
  const mgrStaff = await seedActiveStaff(h, null, actor.userId);
  const mgrNotice = await queueStaffWelcomeNotice(h, NOW.getTime() + DAY_MS, {
    recipient: 'manager',
    email: actor.email,
    targetMaskedEmail: 'ca***@example.test',
    employeeId: mgrStaff.employeeId,
    operationId: mgrStaff.attemptId,
    pinRevision: mgrStaff.pinRevision,
  });
  await h.owner`UPDATE "user" SET email = 'case-mgr@example.test' WHERE id = ${actor.userId}`;
  await h.module.process({
    data: { company_id: mgrNotice.event.companyId, attempt_id: mgrNotice.id },
  });
  expect(await h.read(mgrNotice.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('refuses an invitation without bound user/membership or after invitee membership ends', async () => {
  const actor = await seedCompanyActor(h, 'owner', 'unbound-owner@example.test');
  const unboundId = systemUuidV7().newId();
  const expiresAtMs = NOW.getTime() + 48 * 60 * 60 * 1000;
  await h.owner`
    INSERT INTO member_invitations (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state, link_issued_at)
    VALUES (${TENANT.A.company}, ${unboundId}, ${unboundId.replaceAll('-', '').padEnd(64, 'b')}, 'accountant', 'COMPANY', ${TENANT.A.company}, ${actor.userId}, 'PENDING', ${INVITE_ISSUED_AT.toISOString()}::timestamptz)`;
  const unbound = await queueInvitationNotice(h, expiresAtMs, {
    invitationId: unboundId,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.module.process({ data: { company_id: unbound.event.companyId, attempt_id: unbound.id } });
  expect(await h.read(unbound.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });

  const endedEmail = 'ended-invitee@example.test';
  const endedId = await seedPendingInvitation(h, INVITE_ISSUED_AT, undefined, endedEmail);
  const ended = await queueInvitationNotice(h, expiresAtMs, {
    email: endedEmail,
    invitationId: endedId,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.owner`UPDATE memberships SET ends_at = now() - interval '1 minute' WHERE company_id = ${TENANT.A.company} AND id = (SELECT membership_id FROM member_invitations WHERE company_id = ${TENANT.A.company} AND id = ${endedId})`;
  await h.module.process({ data: { company_id: ended.event.companyId, attempt_id: ended.id } });
  expect(await h.read(ended.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('re-checks admission on a retry delayed past the 1000ms cooldown window', async () => {
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
  const sendDelayed = new SendNotification(
    base.attempts,
    base.channel,
    {
      reserve: async () => {
        reserveCalls += 1;
        return reserveCalls === 1;
      },
    },
    base.identity,
    {
      ...base.configuration,
      verify: async (attempt, scope) => {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          h.advance(new Date(NOW.getTime() + 1_500));
          throw new Error('TRANSIENT_FRESHNESS_READ_FAILURE');
        }
        return base.configuration.verify?.(attempt, scope) ?? true;
      },
    },
    base.clock,
    base.ids,
  );
  await sendDelayed.execute(event.companyId, id);
  expect(reserveCalls).toBe(2);
  expect(await h.read(id)).toMatchObject({ status: 'FAILED', failure_code: 'ADMISSION_REFUSED' });
  expect(channel.requests).toHaveLength(0);
});

it('refuses a manager staff welcome notice after manager email change or revoked branch authority', async () => {
  const managerOne = await seedCompanyActor(h, 'branch_manager', 'mgr-one@example.test');
  const staffOne = await seedActiveStaff(h, null, managerOne.userId);
  const expiresAtMs = NOW.getTime() + DAY_MS;
  const first = await queueStaffWelcomeNotice(h, expiresAtMs, {
    recipient: 'manager',
    email: managerOne.email,
    targetMaskedEmail: 'ca***@example.test',
    employeeId: staffOne.employeeId,
    operationId: staffOne.attemptId,
    pinRevision: staffOne.pinRevision,
  });
  await h.owner`UPDATE "user" SET email = 'mgr-one-new@example.test' WHERE id = ${managerOne.userId}`;
  await h.module.process({ data: { company_id: first.event.companyId, attempt_id: first.id } });
  expect(await h.read(first.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });

  const managerTwo = await seedCompanyActor(h, 'branch_manager', 'mgr-two@example.test');
  const staffTwo = await seedActiveStaff(h, null, managerTwo.userId);
  const second = await queueStaffWelcomeNotice(h, expiresAtMs, {
    recipient: 'manager',
    email: managerTwo.email,
    targetMaskedEmail: 'ca***@example.test',
    employeeId: staffTwo.employeeId,
    operationId: staffTwo.attemptId,
    pinRevision: staffTwo.pinRevision,
  });
  await h.owner`UPDATE memberships SET ends_at = now() - interval '1 minute' WHERE company_id = ${TENANT.A.company} AND id = ${managerTwo.membershipId}`;
  await h.module.process({ data: { company_id: second.event.companyId, attempt_id: second.id } });
  expect(await h.read(second.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('refuses an owner invitation copy after owner email change or lost ownership', async () => {
  const ownerOne = await seedCompanyActor(h, 'owner', 'owner-one@example.test');
  const invOne = await seedPendingInvitation(h, INVITE_ISSUED_AT, ownerOne.userId);
  const expiresAtMs = NOW.getTime() + 48 * 60 * 60 * 1000;
  const first = await queueInvitationNotice(h, expiresAtMs, {
    recipient: 'owner',
    email: ownerOne.email,
    targetMaskedEmail: 'in***@example.test',
    invitationId: invOne,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.owner`UPDATE "user" SET email = 'owner-one-new@example.test' WHERE id = ${ownerOne.userId}`;
  await h.module.process({ data: { company_id: first.event.companyId, attempt_id: first.id } });
  expect(await h.read(first.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });

  const ownerTwo = await seedCompanyActor(h, 'owner', 'owner-two@example.test');
  const invTwo = await seedPendingInvitation(h, INVITE_ISSUED_AT, ownerTwo.userId);
  const second = await queueInvitationNotice(h, expiresAtMs, {
    recipient: 'owner',
    email: ownerTwo.email,
    targetMaskedEmail: 'in***@example.test',
    invitationId: invTwo,
    issuedAt: INVITE_ISSUED_AT.toISOString(),
  });
  await h.owner`UPDATE memberships SET ends_at = now() - interval '1 minute' WHERE company_id = ${TENANT.A.company} AND id = ${ownerTwo.membershipId}`;
  await h.module.process({ data: { company_id: second.event.companyId, attempt_id: second.id } });
  expect(await h.read(second.id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'DESTINATION_INVALID',
  });
  expect(channel.requests).toHaveLength(0);
});

it('records DEADLINE_EXPIRED under the attempt lock when verification crosses send_deadline', async () => {
  const staff = await seedActiveStaff(h);
  const { id, event } = await queueStaffWelcomeNotice(h, NOW.getTime() + 2_000, {
    email: staff.email,
    employeeId: staff.employeeId,
    operationId: staff.attemptId,
    pinRevision: staff.pinRevision,
  });
  const base = h.module.send;
  const pendingAttempt = await base.attempts.pending(event.companyId, id);
  if (pendingAttempt === null) throw new Error('TEST_ATTEMPT_MISSING');
  expect(base.configuration.shouldVerify?.(pendingAttempt)).toBe(true);
  const sendCrossingDeadline = new SendNotification(
    base.attempts,
    base.channel,
    base.admission,
    base.identity,
    {
      ...base.configuration,
      verify: async (attempt, scope) => {
        const ok = await (base.configuration.verify?.(attempt, scope) ?? Promise.resolve(true));
        h.advance(new Date(NOW.getTime() + 3_000));
        return ok;
      },
    },
    base.clock,
    base.ids,
  );
  await sendCrossingDeadline.execute(event.companyId, id);
  expect(await h.read(id)).toMatchObject({
    status: 'EXPIRED',
    failure_code: 'DEADLINE_EXPIRED',
    recipient_email: null,
  });
  expect(channel.requests).toHaveLength(0);
});
