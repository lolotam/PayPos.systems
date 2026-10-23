import type { ClaimedEvent } from '@pospay/db';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createPushTransport } from '../jobs/push-queue.ts';
import { pushProcessor } from '../jobs/push-send.processor.ts';
import { logger } from './harness.ts';
import { OTHER_USER, PUSH_USER } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

const DEADLINE = '2026-10-01T15:00:00.000Z';
const AR_BODY = 'دوامك بينتهي الساعة 18:00 في فرع السالمية.';
const EN_BODY = 'Your shift ends at 18:00 at Salmiya.';

interface Added {
  readonly data: unknown;
}

// طابور وهمي: يسجّل المهام اللي الطابور الحقيقي كان هيستقبلها.
function fakeQueue() {
  const added: Added[] = [];
  const queue = {
    add: async (_name: string, data: unknown) => {
      added.push({ data });
      return { id: 'job' };
    },
  };
  return { added, queue: queue as unknown as Pick<Queue, 'add'> };
}

// الحدث المأخوذ من الـ outbox كما يشوفه عامل الدفع.
function claimed(payload: unknown): ClaimedEvent {
  const data = payload as { company_id: string; attempt_id: string };
  return {
    id: data.attempt_id,
    companyId: data.company_id,
    aggregateType: 'push_attempt',
    aggregateId: data.attempt_id,
    eventType: 'PushSendAuthorized',
    payload,
    attempt: 1,
  };
}

// المستلم مبني داخل الاختبار: القالب الجديد غير مربوط في مساعد الـ harness.
const recipient = (userId = PUSH_USER, shiftEnd = '18:00', timeName = 'shift_end') => ({
  channel: 'PUSH',
  user_id: userId,
  template_key: 'shift_ends_soon',
  template_revision: 1,
  safe_parameters: [
    { name: timeName, type: 'text', value: shiftEnd },
    { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  ],
  send_deadline: DEADLINE,
});

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

it('accepts the shift ending event and writes one pending attempt per live subscription', async () => {
  const arId = h.ids.newId();
  const enId = h.ids.newId();
  await h.subscribe(TENANT.A.company, arId, PUSH_USER, 'ar');
  await h.subscribe(TENANT.A.company, enId, PUSH_USER, 'en');
  const event = await h.request([recipient()], 'ShiftEndsSoon');
  expect(await h.deliver(event)).toEqual({ delivered: true });
  const rows = await h.attempts(event.id);
  const mine = rows.filter((row) => [arId, enId].includes(String(row['subscription_id'])));
  expect(mine).toHaveLength(2);
  expect(mine.map((row) => row['locale']).sort()).toEqual(['ar', 'en']);
  expect(mine.map((row) => row['subscription_id']).sort()).toEqual([arId, enId].sort());
  for (const row of mine) {
    expect(row['template_key']).toBe('shift_ends_soon');
    expect(row['template_revision']).toBe(1);
    expect(row['status']).toBe('PENDING');
    expect(row['send_deadline']).toEqual(new Date(DEADLINE));
  }
});

it('sends the reminder in the language of each subscription with the end time', async () => {
  const arId = h.ids.newId();
  const enId = h.ids.newId();
  const arToken = await h.subscribe(TENANT.A.company, arId, PUSH_USER, 'ar');
  const enToken = await h.subscribe(TENANT.A.company, enId, PUSH_USER, 'en');
  const event = await h.request([recipient()], 'ShiftEndsSoon');
  expect(await h.deliver(event)).toEqual({ delivered: true });
  const rows = await h.attempts(event.id);
  const mine = rows.filter((row) => [arId, enId].includes(String(row['subscription_id'])));
  expect(mine).toHaveLength(2);
  const attemptIds = mine.map((row) => String(row['id'])).sort();
  const authorized = await h.authorized(event.id);
  // الداتابيز مشتركة، فأحداث الإذن فيها محاولات الاختبارات التانية.
  const authorizedMine = authorized.filter((row) =>
    attemptIds.includes(claimed(row['payload']).id),
  );
  expect(authorizedMine).toHaveLength(2);
  expect(authorizedMine.map((row) => claimed(row['payload']).id).sort()).toEqual(attemptIds);
  const queue = fakeQueue();
  const transport = createPushTransport(queue.queue, async () => ({ delivered: true }), logger);
  for (const row of authorizedMine) await transport(claimed(row['payload']));
  expect(queue.added).toHaveLength(2);
  const processor = pushProcessor(h.send, logger);
  const before = h.channel.requests.length;
  for (const job of queue.added) await processor({ data: job.data });
  const sent = h.channel.requests.slice(before);
  expect(sent).toHaveLength(2);
  const ar = sent.find((request) => JSON.parse(request.payload)['t'] === arToken);
  const en = sent.find((request) => JSON.parse(request.payload)['t'] === enToken);
  expect(JSON.parse(ar?.payload ?? '{}')).toEqual({
    v: 1,
    title: 'دوامك قرب يخلص',
    body: AR_BODY,
    tag: 'shift_ends_soon',
    url: '/personal',
    lang: 'ar',
    t: arToken,
  });
  expect(JSON.parse(en?.payload ?? '{}')).toEqual({
    v: 1,
    title: 'Shift ending soon',
    body: EN_BODY,
    tag: 'shift_ends_soon',
    url: '/personal',
    lang: 'en',
    t: enToken,
  });
  for (const request of sent) expect(request.deadline).toEqual(new Date(DEADLINE));
  for (const row of mine) {
    const [attempt] = await h.attempt(String(row['id']));
    expect(attempt?.['status']).toBe('SENT');
  }
  const calls = h.channel.calls;
  for (const job of queue.added) await processor({ data: job.data });
  expect(h.channel.calls).toBe(calls);
});

it('writes no attempt for a user without a live subscription', async () => {
  const event = await h.request([recipient(OTHER_USER)], 'ShiftEndsSoon');
  expect(await h.deliver(event)).toEqual({ delivered: true });
  expect(await h.attempts(event.id)).toHaveLength(0);
});

it('refuses a malformed shift end and writes no attempt', async () => {
  const subscriptionId = h.ids.newId();
  await h.subscribe(TENANT.A.company, subscriptionId, PUSH_USER, 'ar');
  const event = await h.request([recipient(PUSH_USER, '24:00')], 'ShiftEndsSoon');
  const outcome = await h.deliver(event);
  expect(outcome.delivered).toBe(false);
  expect(await h.attempts(event.id)).toHaveLength(0);
  await expect(
    h.db.withTenant(event.companyId, (tx) => h.consumer.handle(tx, event)),
  ).rejects.toThrow('NOTIFICATION_REQUEST_INVALID');
});

it('refuses a recipient that names the shift start instead of the shift end', async () => {
  const subscriptionId = h.ids.newId();
  await h.subscribe(TENANT.A.company, subscriptionId, PUSH_USER, 'ar');
  const event = await h.request([recipient(PUSH_USER, '18:00', 'shift_start')], 'ShiftEndsSoon');
  const outcome = await h.deliver(event);
  expect(outcome.delivered).toBe(false);
  expect(await h.attempts(event.id)).toHaveLength(0);
  await expect(
    h.db.withTenant(event.companyId, (tx) => h.consumer.handle(tx, event)),
  ).rejects.toThrow('NOTIFICATION_REQUEST_INVALID');
});
