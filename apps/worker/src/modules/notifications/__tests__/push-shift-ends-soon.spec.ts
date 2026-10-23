import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { OTHER_USER, PUSH_USER } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

const DEADLINE = '2026-10-01T15:00:00.000Z';
const AR_BODY = 'دوامك بينتهي الساعة 18:00 في فرع السالمية.';
const EN_BODY = 'Your shift ends at 18:00 at Salmiya.';

// المستلم مبني داخل الاختبار: القالب الجديد غير مربوط في مساعد الـ harness.
const recipient = (userId = PUSH_USER, shiftEnd = '18:00') => ({
  channel: 'PUSH',
  user_id: userId,
  template_key: 'shift_ends_soon',
  template_revision: 1,
  safe_parameters: [
    { name: 'shift_end', type: 'text', value: shiftEnd },
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
  const before = h.channel.requests.length;
  for (const row of mine) await h.send.execute(TENANT.A.company, String(row['id']));
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
