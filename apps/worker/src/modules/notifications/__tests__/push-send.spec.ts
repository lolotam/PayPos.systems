import { pushTopic } from '@pospay/notifications';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { SendPush } from '../use-cases/send-push/send-push.ts';
import { ENDPOINT, P256DH, AUTH } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;
const AR_BODY = 'لسه مفيش بصمة حضور ليك لشيفت الساعة 10:00 في فرع السالمية.';
const EN_BODY = 'No clock-in yet for your 10:00 shift at Salmiya.';

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

it('sends the attempt once and the second execution sends nothing', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  await h.send.execute(TENANT.A.company, attemptId);
  await h.send.execute(TENANT.A.company, attemptId);
  expect(h.channel.calls).toBe(before + 1);
  const rows = await h.attempt(attemptId);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['status']).toBe('SENT');
});

it('sends once when two executions race for the same attempt', async () => {
  const { attemptId } = await h.authorizeAttempt('en');
  const before = h.channel.calls;
  await Promise.all([
    h.send.execute(TENANT.A.company, attemptId),
    h.send.execute(TENANT.A.company, attemptId),
  ]);
  expect(h.channel.calls).toBe(before + 1);
});

it('reserves one admission slot when two executions race for the same attempt', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  let reserved = 0;
  const limited = new SendPush(
    h.send.deliveries,
    h.send.builder,
    h.send.channel,
    {
      reserve: async () => {
        reserved += 1;
        return true;
      },
    },
    h.send.keyId,
    h.send.clock,
    h.send.ids,
  );
  await Promise.all([
    limited.execute(TENANT.A.company, attemptId),
    limited.execute(TENANT.A.company, attemptId),
  ]);
  expect(reserved).toBe(1);
  expect(h.channel.calls).toBe(before + 1);
  expect((await h.attempt(attemptId))[0]?.['status']).toBe('SENT');
});

it('sends nothing when the claim is lost', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const losing = new SendPush(
    { ...h.send.deliveries, claim: async () => false },
    h.send.builder,
    h.send.channel,
    h.send.admission,
    h.send.keyId,
    h.send.clock,
    h.send.ids,
  );
  const outcome = await losing.execute(TENANT.A.company, attemptId);
  expect(outcome).toBeNull();
  expect(h.channel.calls).toBe(before);
  expect((await h.attempt(attemptId))[0]?.['status']).toBe('PENDING');
});

it('records the sent row and one delivered event with no secret in it', async () => {
  const { attemptId, deliveryToken } = await h.authorizeAttempt('ar');
  await h.send.execute(TENANT.A.company, attemptId);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({
    status: 'SENT',
    http_status: 201,
    failure_code: null,
    outcome_known: true,
  });
  expect(row?.['finished_at']).not.toBeNull();
  const events = await h.events(attemptId);
  expect(events).toHaveLength(1);
  expect(events[0]?.['event_type']).toBe('NotificationDelivered');
  const payload = events[0]?.['payload'] as Record<string, unknown>;
  expect(payload['channel']).toBe('PUSH');
  expect(payload['evidence']).toBe('PROVIDER_ACCEPTED');
  expect(payload['status']).toBe('SENT');
  const text = JSON.stringify(payload);
  for (const secret of [ENDPOINT, P256DH, AUTH, deliveryToken, 'بصمة الحضور'])
    expect(text, secret).not.toContain(secret);
});

it('sends the notice in the language of the subscription', async () => {
  const { attemptId, deliveryToken } = await h.authorizeAttempt('ar');
  await h.send.execute(TENANT.A.company, attemptId);
  const request = h.channel.requests.at(-1);
  expect(JSON.parse(request?.payload ?? '{}')).toEqual({
    v: 1,
    title: 'بصمة الحضور',
    body: AR_BODY,
    tag: 'shift_not_clocked_in_self',
    url: '/personal',
    lang: 'ar',
    t: deliveryToken,
  });
  expect(request?.ttlSeconds).toBe(3600);
  expect(request?.urgency).toBe('high');
});

it('sends the english notice for an english subscription', async () => {
  const { attemptId, deliveryToken } = await h.authorizeAttempt('en');
  await h.send.execute(TENANT.A.company, attemptId);
  const request = h.channel.requests.at(-1);
  expect(JSON.parse(request?.payload ?? '{}')).toEqual({
    v: 1,
    title: 'Clock-in',
    body: EN_BODY,
    tag: 'shift_not_clocked_in_self',
    url: '/personal',
    lang: 'en',
    t: deliveryToken,
  });
});

it('sends the topic of the source event and the seconds left to the deadline', async () => {
  const { attemptId, eventId } = await h.authorizeAttempt('ar', {
    deadline: '2026-10-01T10:30:00Z',
  });
  await h.send.execute(TENANT.A.company, attemptId);
  const request = h.channel.requests.at(-1);
  expect(request?.topic).toBe(pushTopic(eventId));
  expect(request?.topic).toHaveLength(32);
  expect(request?.ttlSeconds).toBe(1800);
});

it('expires a pending attempt whose deadline passed without any call', async () => {
  const { subscriptionId } = await h.authorizeAttempt('ar');
  const attemptId = await h.pendingAttempt({
    subscriptionId,
    deadline: '2026-10-01T09:00:00Z',
  });
  const before = h.channel.calls;
  const outcome = await h.send.execute(TENANT.A.company, attemptId);
  expect(outcome?.status).toBe('EXPIRED');
  expect(outcome?.failureCode).toBe('DEADLINE_EXPIRED');
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'EXPIRED', failure_code: 'DEADLINE_EXPIRED' });
});

it('leaves the attempt pending when the deadline passes before the claim', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const losing = new SendPush(
    { ...h.send.deliveries, claim: async () => false },
    h.send.builder,
    h.send.channel,
    h.send.admission,
    h.send.keyId,
    h.send.clock,
    h.send.ids,
  );
  expect(await losing.execute(TENANT.A.company, attemptId)).toBeNull();
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'PENDING', execution_id: null });
});
