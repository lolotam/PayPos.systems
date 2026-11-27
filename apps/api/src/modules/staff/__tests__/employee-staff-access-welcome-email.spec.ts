import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deriveOnboardingEnvelopeKey,
  onboardingPlaceholderEmail,
  STAFF_WELCOME_PIN_KEY,
  unsealOnboardingEmailEnvelope,
} from '@pospay/notifications';

import {
  addEmployee,
  capturedLogs,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

const SEALING_KEY = 'onboarding-envelope-secret-key-0123456789';
const OWNER_EMAIL = 'staff-access-owner@example.test';
const RECOVERY_EMAIL = 'sara.recovery@example.test';
const PIN = '1234';

type NoticeRecipient = {
  readonly email: string;
  readonly template_key: string;
  readonly template_revision: number;
  readonly safe_parameters: readonly { readonly name: string; readonly value: string }[];
};

const noticeEvents = async (f: Fixture) =>
  f.h
    .owner`SELECT event_type, payload FROM outbox WHERE event_type = 'StaffWelcomePinNoticeRequested'`;

const recipientsOf = (payload: unknown): readonly NoticeRecipient[] =>
  (payload as { notification_recipients?: NoticeRecipient[] }).notification_recipients ?? [];

const managerRecipient = (recipients: readonly NoticeRecipient[]) => {
  const key = deriveOnboardingEnvelopeKey(SEALING_KEY) ?? Buffer.alloc(0);
  const placeholder = onboardingPlaceholderEmail(OWNER_EMAIL, key) ?? '';
  return recipients.find((recipient) => recipient.email === placeholder);
};

const unsealManagerNotice = (companyId: string, recipient: NoticeRecipient) =>
  unsealOnboardingEmailEnvelope(
    deriveOnboardingEnvelopeKey(SEALING_KEY) ?? Buffer.alloc(0),
    recipient.safe_parameters,
    {
      companyId,
      templateKey: STAFF_WELCOME_PIN_KEY,
      templateRevision: 1,
      placeholderEmail: recipient.email,
    },
    new Date(),
  );

const assertSealedAndClean = async (f: Fixture, payload: unknown) => {
  const recipients = recipientsOf(payload);
  expect(recipients).toHaveLength(2);
  for (const recipient of recipients) {
    expect(recipient.email).toMatch(/^sealed-[0-9a-f]{24}@redacted\.invalid$/);
    expect(recipient.template_key).toBe(STAFF_WELCOME_PIN_KEY);
    expect(recipient.template_revision).toBe(1);
    expect(recipient.safe_parameters[0]?.name).toBe('env_0');
  }
  const serialized = JSON.stringify(payload);
  for (const forbidden of [PIN, OWNER_EMAIL, RECOVERY_EMAIL])
    expect(serialized).not.toContain(forbidden);
  const audits = await f.h
    .owner`SELECT action, before, after FROM audit_log WHERE company_id = ${f.company}`;
  expect(JSON.stringify(audits)).not.toContain(PIN);
  expect(JSON.stringify(audits)).not.toContain(RECOVERY_EMAIL);
  expect(capturedLogs()).not.toContain(PIN);
  expect(capturedLogs()).not.toContain(RECOVERY_EMAIL);
};

describe('the staff welcome email with a sealing key', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await staffAccessFixture({ staffAccessRoutes: true, onboardingEmailKey: SEALING_KEY });
  });
  afterAll(async () => {
    await f?.db.close();
    await f?.h.close();
  });

  it('writes one sealed notice for the manager and the employee, with no plaintext', async () => {
    const sara = await addEmployee(f, 'Sara', f.salmiya, 1);
    await f.h.owner`UPDATE employees SET recovery_email = ${RECOVERY_EMAIL} WHERE id = ${sara}`;
    expect((await grant(f, sara, nextPhone(f))).status).toBe(200);
    const events = await noticeEvents(f);
    expect(events).toHaveLength(1);
    await assertSealedAndClean(f, events[0]?.payload);
  });

  it('sends only to the manager when the employee has no recovery email', async () => {
    const huda = await addEmployee(f, 'Huda', f.salmiya, 4);
    expect((await grant(f, huda, nextPhone(f))).status).toBe(200);
    const events = await f.h
      .owner`SELECT payload FROM outbox WHERE event_type = 'StaffWelcomePinNoticeRequested' AND aggregate_id = ${huda}`;
    expect(events).toHaveLength(1);
    const recipients = recipientsOf(events[0]?.payload);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.email).toBe(
      onboardingPlaceholderEmail(
        OWNER_EMAIL,
        deriveOnboardingEnvelopeKey(SEALING_KEY) ?? Buffer.alloc(0),
      ),
    );
  });

  it('unseals the notice for the worker with the shared key', async () => {
    const nora = await addEmployee(f, 'Nora', f.hawalli, 2);
    await grant(f, nora, nextPhone(f));
    const events = await noticeEvents(f);
    const manager = managerRecipient(recipientsOf(events[events.length - 1]?.payload));
    expect(manager).toBeDefined();
    expect(manager && unsealManagerNotice(f.company, manager)).toMatchObject({
      kind: 'staff_welcome_pin',
      email: OWNER_EMAIL,
      pin: PIN,
      role: 'staff',
      recipient: 'manager',
    });
  });
});

describe('the staff welcome email without a sealing key', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await staffAccessFixture({ staffAccessRoutes: true });
  });
  afterAll(async () => {
    await f?.db.close();
    await f?.h.close();
  });

  it('grants the access and writes no notice at all', async () => {
    const sara = await addEmployee(f, 'Sara', f.salmiya, 3);
    await f.h.owner`UPDATE employees SET recovery_email = ${RECOVERY_EMAIL} WHERE id = ${sara}`;
    const response = await grant(f, sara, nextPhone(f));
    expect(response.status).toBe(200);
    expect(await noticeEvents(f)).toHaveLength(0);
  });
});
