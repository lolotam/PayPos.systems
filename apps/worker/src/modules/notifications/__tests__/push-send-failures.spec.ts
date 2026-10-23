import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { pushSendHarness } from './push-send-harness.ts';

let h: Awaited<ReturnType<typeof pushSendHarness>>;

beforeAll(async () => {
  h = await pushSendHarness();
});
afterAll(async () => {
  await h.close();
});

const rotateKey = async (subscriptionId: string) =>
  h.owner`UPDATE push_subscriptions SET vapid_key_id = 'fedcba9876543210' WHERE id = ${subscriptionId}`;

const bumpGeneration = async (subscriptionId: string) =>
  h.owner`UPDATE push_subscriptions SET generation = generation + 1 WHERE id = ${subscriptionId}`;

const revoke = async (subscriptionId: string) =>
  h.owner`UPDATE push_subscriptions SET revoked_at = now(), revoked_reason = 'UNSUBSCRIBED',
    endpoint = NULL, p256dh = NULL, auth = NULL, delivery_token = NULL, generation = generation + 1
    WHERE id = ${subscriptionId}`;

it('revokes the subscription and fails the attempt when the push service says it is gone', async () => {
  for (const [outcome, httpStatus] of [
    ['gone404', 404],
    ['gone410', 410],
  ] as const) {
    const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
    h.channel.outcome = outcome;
    const before = h.channel.calls;
    const result = await h.send.execute(TENANT.A.company, attemptId);
    expect(result).toMatchObject({
      status: 'FAILED',
      failureCode: 'SUBSCRIPTION_GONE',
      httpStatus,
      vapidRejected: false,
    });
    expect(h.channel.calls).toBe(before + 1);
    const [row] = await h.attempt(attemptId);
    expect(row).toMatchObject({
      status: 'FAILED',
      failure_code: 'SUBSCRIPTION_GONE',
      outcome_known: true,
      http_status: httpStatus,
    });
    const [subscription] = await h.subscription(subscriptionId);
    expect(subscription).toMatchObject({ revoked_reason: 'GONE', endpoint: null, p256dh: null });
    expect(subscription?.['auth']).toBeNull();
    expect(subscription?.['delivery_token']).toBeNull();
    expect(subscription?.['generation']).toBe(2);
    const events = await h.events(attemptId);
    expect(events).toHaveLength(1);
    expect(events[0]?.['event_type']).toBe('NotificationFailed');
  }
});

it('refuses a subscription made under another key and revokes it', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  await rotateKey(subscriptionId);
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'KEY_ROTATED' });
  expect(h.channel.calls).toBe(before);
  const [row] = await h.attempt(attemptId);
  expect(row).toMatchObject({ status: 'FAILED', failure_code: 'KEY_ROTATED' });
  const [subscription] = await h.subscription(subscriptionId);
  expect(subscription?.['revoked_reason']).toBe('KEY_ROTATED');
});

it('refuses an attempt whose subscription changed since the authorization', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  await bumpGeneration(subscriptionId);
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'SUBSCRIPTION_CHANGED' });
  expect(h.channel.calls).toBe(before);
  const [subscription] = await h.subscription(subscriptionId);
  expect(subscription?.['revoked_at']).toBeNull();
  expect(subscription?.['endpoint']).not.toBeNull();
});

it('keeps the replacement subscription when a late answer says the old one is gone', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  h.channel.outcome = 'gone410';
  Object.assign(h.channel.hooks, {
    afterSubmission: async () => {
      await h.owner`UPDATE push_subscriptions SET generation = generation + 1,
        endpoint = 'https://fcm.googleapis.com/fcm/send/replacement', delivery_token = ${h.ids.newId()}
        WHERE id = ${subscriptionId}`;
    },
  });
  const result = await h.send.execute(TENANT.A.company, attemptId);
  Object.assign(h.channel.hooks, { afterSubmission: undefined });
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'SUBSCRIPTION_GONE' });
  const [subscription] = await h.subscription(subscriptionId);
  expect(subscription?.['revoked_at']).toBeNull();
  expect(subscription?.['endpoint']).toBe('https://fcm.googleapis.com/fcm/send/replacement');
});

it('refuses a revoked subscription without any call', async () => {
  const { attemptId, subscriptionId } = await h.authorizeAttempt('ar');
  await revoke(subscriptionId);
  const before = h.channel.calls;
  const result = await h.send.execute(TENANT.A.company, attemptId);
  expect(result).toMatchObject({ status: 'FAILED', failureCode: 'SUBSCRIPTION_REVOKED' });
  expect(h.channel.calls).toBe(before);
});
