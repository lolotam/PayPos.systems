import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createPushDeliveryRepository } from '../persistence/drizzle-push-delivery.repository.ts';
import type { PushAdmission } from '../ports/push-admission.port.ts';
import { SendPush } from '../use-cases/send-push/send-push.ts';
import { NOW } from './push-harness.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

const send = (admission: PushAdmission, clock = h.send.clock) =>
  new SendPush(
    h.send.deliveries,
    h.send.builder,
    h.send.channel,
    admission,
    h.send.keyId,
    clock,
    h.send.ids,
  );

it('refuses an endpoint that is not an allowed push service and scrubs the subscription', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  await h.owner`UPDATE push_subscriptions SET endpoint = 'https://evil.example.test/x'
    WHERE id = ${subscriptionId}`;
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'SUBSCRIPTION_GONE' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'SUBSCRIPTION_GONE' });
  const [subscription] = await h.subscription(subscriptionId);
  expect(subscription?.['revoked_reason']).toBe('GONE');
  expect(subscription?.['endpoint']).toBeNull();
  expect(subscription?.['p256dh']).toBeNull();
  expect(subscription?.['auth']).toBeNull();
  expect(subscription?.['delivery_token']).toBeNull();
});

it('records a changed subscription instead of leaving the attempt pending', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const changing = send({
    reserve: async () => {
      await h.owner`UPDATE push_subscriptions SET generation = generation + 1
        WHERE id = ${subscriptionId}`;
      return true;
    },
  });
  const result = await changing.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'SUBSCRIPTION_CHANGED' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'SUBSCRIPTION_CHANGED' });
});

it('expires an attempt whose deadline passed between the build and the claim', async () => {
  const { attemptId } = await h.authorizeAttempt('ar', { deadline: '2026-10-01T10:30:00Z' });
  const before = h.channel.calls;
  let current = NOW;
  const clock = { now: () => new Date(current) };
  const advancing = send(
    {
      reserve: async () => {
        current = new Date(NOW.getTime() + 3_600_000);
        return true;
      },
    },
    clock,
  );
  const result = await advancing.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'EXPIRED', failureCode: 'DEADLINE_EXPIRED' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'EXPIRED', failure_code: 'DEADLINE_EXPIRED' });
  expect(await h.events(attemptId)).toHaveLength(1);
});

it('refuses the claim when the subscription generation changed', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  const repository = createPushDeliveryRepository(h.db);
  const delivery = await repository.pending(TENANT.A.company, attemptId);
  if (delivery === null) throw new Error('TEST_DELIVERY_MISSING');
  await h.owner`UPDATE push_subscriptions SET generation = generation + 1
    WHERE id = ${subscriptionId}`;
  expect(await repository.claim(delivery, '01920000-0000-7000-8000-0000000000a9', NOW)).toBe(false);
  expect((await h.attempt(attemptId))[0]?.['status']).toBe('PENDING');
});

it('records a failed admission instead of leaving the attempt pending', async () => {
  const { attemptId } = await h.authorizeAttempt('ar');
  const before = h.channel.calls;
  const failing = send({
    reserve: async () => {
      throw new Error('PUSH_ADMISSION_UNAVAILABLE');
    },
  });
  const result = await failing.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'ADMISSION_REFUSED' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'ADMISSION_REFUSED' });
});
