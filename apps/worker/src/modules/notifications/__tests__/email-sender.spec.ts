import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { SendNotification } from '../use-cases/send-notification/send-notification.ts';
import { createAttemptsRepository } from '../persistence/drizzle-attempts.repository.ts';
import { createInAppNotificationModule } from '../notifications.module.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { NOW, notificationHarness, logger, testEmailOptions } from './harness.ts';

const EMAIL = 'synthetic.owner@example.invalid';
let h: Awaited<ReturnType<typeof notificationHarness>>;
beforeAll(async () => {
  h = await notificationHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(() => {
  h.advance(NOW);
  h.emailChannel.outcome = 'accepted';
});

async function authorize(overrides: Record<string, unknown> = {}) {
  const event = await h.request({
    channel: 'email',
    email: EMAIL,
    template_key: 'document_expiring',
    ...overrides,
  });
  await h.deliver(event);
  return { event, id: await h.attempt(event) };
}
function sender(attempts: typeof h.module.send.attempts) {
  const original = h.module.send;
  return new SendNotification(
    attempts,
    original.channel,
    original.admission,
    original.identity,
    original.configuration,
    original.clock,
    original.ids,
  );
}

it.each(['ar', 'en'])(
  'commits EMAIL authorization, fences concurrent jobs and records %s acceptance once',
  async (locale) => {
    const { event, id } = await authorize({ locale });
    const before = h.emailChannel.calls;
    const initial = await h.read(id);
    expect(initial).toMatchObject({
      status: 'PENDING',
      channel: 'email',
      recipient_phone: null,
      phone_last3: null,
      recipient_email: EMAIL,
    });
    await h.deliver(event);
    await Promise.all([
      h.module.process({ data: { company_id: event.companyId, attempt_id: id } }),
      h.module.process({ data: { company_id: event.companyId, attempt_id: id } }),
    ]);
    expect(h.emailChannel.calls).toBe(before + 1);
    expect(await h.read(id)).toMatchObject({
      status: 'SENT',
      recipient_email: null,
      recipient_phone: null,
      provider_message_id: 'fake-message-id',
      outcome_known: true,
      recipient_hash: initial?.['recipient_hash'],
    });
    const internal = (await h.events()).filter((e) => e.payload['attempt_id'] === id);
    expect(internal.map((e) => e.event_type)).toEqual([
      'NotificationSendAuthorized',
      'NotificationDelivered',
    ]);
    expect(internal[1]?.payload).toMatchObject({ channel: 'email', evidence: 'PROVIDER_ACCEPTED' });
    expect(JSON.stringify(internal)).not.toContain(EMAIL);
    await h.module.send.execute(event.companyId, id);
    expect(h.emailChannel.calls).toBe(before + 1);
  },
);

it.each(['4xx', '429', '5xx', 'timeout'] as const)(
  '%s is visible and never resubmitted',
  async (outcome) => {
    const { event, id } = await authorize();
    h.emailChannel.outcome = outcome;
    const before = h.emailChannel.calls;
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({
      status: 'FAILED',
      recipient_email: null,
      recipient_phone: null,
      outcome_known: ['4xx', '429'].includes(outcome),
      provider_message_id: null,
    });
    await h.module.send.execute(event.companyId, id);
    await h.deliver(event);
    expect(h.emailChannel.calls).toBe(before + 1);
  },
);

it.each([
  [{ locale: null }, 'LOCALE_MISSING'],
  [{ locale: 'fr' }, 'LOCALE_UNSUPPORTED'],
  [{ email: 'bad address' }, 'DESTINATION_INVALID'],
  [
    { safe_parameters: [{ name: 'body', type: 'text', value: 'private body' }] },
    'PARAMETERS_INVALID',
  ],
  [{ send_deadline: NOW.toISOString() }, 'DEADLINE_EXPIRED'],
] as const)(
  'refuses invalid/expired input without provider submission',
  async (overrides, code) => {
    const before = h.emailChannel.calls;
    const { event, id } = await authorize(overrides);
    await h.module.send.execute(event.companyId, id);
    expect(await h.read(id)).toMatchObject({ failure_code: code, recipient_email: null });
    expect(h.emailChannel.calls).toBe(before);
  },
);

it('an unknown claim COMMIT acknowledgement never permits a send', async () => {
  const { event, id } = await authorize();
  const before = h.emailChannel.calls;
  const attempts = {
    ...h.module.send.attempts,
    claim: async (...args: Parameters<typeof h.module.send.attempts.claim>) => {
      await h.module.send.attempts.claim(...args);
      throw Object.assign(new Error('UNKNOWN_COMMIT'), { name: 'CommitOutcomeUnknownError' });
    },
  };
  await expect(sender(attempts).execute(event.companyId, id)).rejects.toThrow('UNKNOWN_COMMIT');
  expect(await h.read(id)).toMatchObject({ status: 'SENDING', provider_message_id: null });
  await h.module.send.execute(event.companyId, id);
  expect(h.emailChannel.calls).toBe(before);
});

it('acceptance then crash leaves NULL id unknown, preserves the fence and never resends', async () => {
  const { event, id } = await authorize();
  const before = h.emailChannel.calls;
  await expect(
    sender({
      ...h.module.send.attempts,
      finish: async () => {
        throw new Error('RESULT_LOST');
      },
    }).execute(event.companyId, id),
  ).rejects.toThrow('RESULT_LOST');
  expect(await h.read(id)).toMatchObject({
    status: 'SENDING',
    provider_message_id: null,
    recipient_email: EMAIL,
  });
  await h.module.send.execute(event.companyId, id);
  expect(h.emailChannel.calls).toBe(before + 1);
});

it('result transaction rollback retries only persistence and clears address with one result event', async () => {
  const { event, id } = await authorize();
  let rollback = true;
  const repository = createAttemptsRepository({
    withTenant: (company, fn, options) =>
      h.db.withTenant(
        company,
        async (tx) => {
          const result = await fn(tx);
          if (rollback) {
            rollback = false;
            throw new Error('RESULT_ROLLBACK');
          }
          return result;
        },
        options,
      ),
  });
  const before = h.emailChannel.calls;
  await sender({ ...h.module.send.attempts, finish: repository.finish }).execute(
    event.companyId,
    id,
  );
  expect(h.emailChannel.calls).toBe(before + 1);
  expect(await h.read(id)).toMatchObject({ status: 'SENT', recipient_email: null });
  expect(
    (await h.events()).filter(
      (e) => e.payload['attempt_id'] === id && e.event_type === 'NotificationDelivered',
    ),
  ).toHaveLength(1);
});

it('drained cleanup clears email after 24h without restoring a destination or resetting SENDING', async () => {
  const { event, id } = await authorize();
  h.emailChannel.outcome = 'crash';
  const before = h.emailChannel.calls;
  await expect(h.module.send.execute(event.companyId, id)).rejects.toThrow('FAKE_EXECUTION_CRASH');
  const row = await h.read(id);
  const input = {
    company_id: event.companyId,
    attempt_id: id,
    execution_id: String(row?.['execution_id']),
    operator_id: USER,
    execution_stopped: true,
  };
  expect(await h.module.cleanup(input)).toBe(false);
  h.advance(new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
  expect(await h.module.cleanup(input)).toBe(true);
  expect(await h.read(id)).toMatchObject({
    status: 'SENDING',
    execution_id: row?.['execution_id'],
    recipient_email: null,
    provider_message_id: null,
  });
  await h.module.send.execute(event.companyId, id);
  expect(h.emailChannel.calls).toBe(before + 1);
});

it('live-disabled production records an owner-visible failure without authorization or HTTP', async () => {
  const config = testEmailOptions(h.emailChannel).emailConfiguration;
  const module = createInAppNotificationModule({
    database: h.db,
    ids: h.module.send.ids,
    clock: h.clock,
    emailConfiguration: config,
  });
  expect(module.emailCapability).toMatchObject({ enabled: false });
  const event = await h.request({ channel: 'email', template_key: 'document_expiring' });
  const deliver = createDeliverer(h.db, [module.consumer], logger, {
    knownEventTypes: module.eventTypes,
  });
  const before = h.emailChannel.calls;
  await deliver(event);
  const id = await h.attempt(event);
  expect(await h.read(id)).toMatchObject({
    status: 'FAILED',
    failure_code: 'CONFIG_INVALID',
    recipient_email: null,
  });
  expect(
    (await h.events()).filter((e) => e.payload['attempt_id'] === id).map((e) => e.event_type),
  ).toEqual(['NotificationFailed']);
  expect(h.emailChannel.calls).toBe(before);
});

it('suppression seam refuses email independently of WhatsApp with no authorization', async () => {
  h.suppress();
  const before = h.emailChannel.calls;
  const { event, id } = await authorize();
  await h.module.send.execute(event.companyId, id);
  expect(await h.read(id)).toMatchObject({
    status: 'SUPPRESSED',
    recipient_email: null,
    phone_last3: null,
  });
  expect(h.emailChannel.calls).toBe(before);
  const rows = await h.db.withTenant(event.companyId, (tx) =>
    tx.execute(sql`SELECT id FROM notification_attempts WHERE id = ${id}`),
  );
  expect(rows).toHaveLength(1);
});
