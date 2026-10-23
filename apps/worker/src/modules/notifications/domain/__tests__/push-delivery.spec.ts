import { describe, expect, it } from 'vitest';

import {
  invalidEndpointDecision,
  pushDecisionFromSubmission,
  pushPreflight,
  refusedDecision,
  type PushDelivery,
  type PushDeliveryAttempt,
  type PushDeliverySubscription,
} from '../push-delivery.ts';

const NOW = new Date('2026-10-01T10:00:00Z');
const KEY_ID = '0123456789abcdef';

const attempt = (over: Partial<PushDeliveryAttempt> = {}): PushDeliveryAttempt => ({
  companyId: '01920000-0000-7000-8000-0000000000a1',
  id: '01920000-0000-7000-8000-0000000000b1',
  subscriptionId: '01920000-0000-7000-8000-0000000000c1',
  subscriptionGeneration: 1,
  userId: '01920000-0000-7000-8000-0000000000d1',
  businessId: null,
  branchId: null,
  sourceEventId: '01920000-0000-7000-8000-0000000000e1',
  templateKey: 'shift_not_clocked_in_self',
  templateRevision: 1,
  locale: 'ar',
  safeParameters: [],
  status: 'PENDING',
  deadline: null,
  executionId: null,
  sendingAt: null,
  ...over,
});

const subscription = (over: Partial<PushDeliverySubscription> = {}): PushDeliverySubscription => ({
  generation: 1,
  vapidKeyId: KEY_ID,
  revokedAt: null,
  endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
  p256dh: 'synthetic-p256dh',
  auth: 'synthetic-auth',
  deliveryToken: 'synthetic-delivery-token',
  ...over,
});

const delivery = (
  overAttempt: Partial<PushDeliveryAttempt> = {},
  overSubscription: Partial<PushDeliverySubscription> = {},
): PushDelivery => ({
  attempt: attempt(overAttempt),
  subscription: subscription(overSubscription),
});

describe('pushPreflight', () => {
  it('lets a live attempt with a live subscription pass', () => {
    expect(pushPreflight(delivery(), KEY_ID, NOW)).toBeNull();
  });

  it('expires a deadline that is exactly now', () => {
    expect(pushPreflight(delivery({ deadline: NOW }), KEY_ID, NOW)).toEqual({
      result: {
        status: 'EXPIRED',
        failureCode: 'DEADLINE_EXPIRED',
        outcomeKnown: true,
        httpStatus: null,
      },
      revoke: null,
      vapidRejected: false,
    });
  });

  it('reports a revoked subscription before a stale generation', () => {
    const decision = pushPreflight(
      delivery({ subscriptionGeneration: 1 }, { revokedAt: NOW, generation: 5 }),
      KEY_ID,
      NOW,
    );
    expect(decision?.result.failureCode).toBe('SUBSCRIPTION_REVOKED');
  });

  it('reports a missing secret as a revoked subscription', () => {
    const decisions = [
      pushPreflight(delivery({}, { endpoint: null }), KEY_ID, NOW),
      pushPreflight(delivery({}, { p256dh: null }), KEY_ID, NOW),
      pushPreflight(delivery({}, { auth: null }), KEY_ID, NOW),
      pushPreflight(delivery({}, { deliveryToken: null }), KEY_ID, NOW),
    ];
    for (const decision of decisions)
      expect(decision?.result.failureCode).toBe('SUBSCRIPTION_REVOKED');
  });

  it('reports a stale generation before a stale key', () => {
    const decision = pushPreflight(
      delivery({ subscriptionGeneration: 1 }, { generation: 2, vapidKeyId: 'fedcba9876543210' }),
      KEY_ID,
      NOW,
    );
    expect(decision?.result.failureCode).toBe('SUBSCRIPTION_CHANGED');
  });

  it('reports a rotated key and asks for the subscription to be revoked', () => {
    const decision = pushPreflight(delivery({}, { vapidKeyId: 'fedcba9876543210' }), KEY_ID, NOW);
    expect(decision).toEqual({
      result: {
        status: 'FAILED',
        failureCode: 'KEY_ROTATED',
        outcomeKnown: true,
        httpStatus: null,
      },
      revoke: 'KEY_ROTATED',
      vapidRejected: false,
    });
  });

  it('never reports a rotated key when there is no key to compare with', () => {
    expect(pushPreflight(delivery(), null, NOW)).toBeNull();
    expect(pushPreflight(delivery({}, { vapidKeyId: 'fedcba9876543210' }), null, NOW)).toBeNull();
  });
});

describe('the accepted and gone answers', () => {
  it('turns an accepted answer into a sent attempt', () => {
    expect(pushDecisionFromSubmission({ kind: 'accepted', httpStatus: 201 })).toEqual({
      result: { status: 'SENT', failureCode: null, outcomeKnown: true, httpStatus: 201 },
      revoke: null,
      vapidRejected: false,
    });
  });

  it('turns a gone answer into a failed attempt and a revoked subscription', () => {
    for (const httpStatus of [404, 410])
      expect(pushDecisionFromSubmission({ kind: 'gone', httpStatus })).toEqual({
        result: {
          status: 'FAILED',
          failureCode: 'SUBSCRIPTION_GONE',
          outcomeKnown: true,
          httpStatus,
        },
        revoke: 'GONE',
        vapidRejected: false,
      });
  });
});

describe('the rejected and unknown answers', () => {
  it('keeps the provider code of a rejected answer and the key rejection', () => {
    expect(
      pushDecisionFromSubmission({
        kind: 'rejected',
        code: 'PROVIDER_4XX',
        httpStatus: 401,
        vapidRejected: true,
      }),
    ).toEqual({
      result: {
        status: 'FAILED',
        failureCode: 'PROVIDER_4XX',
        outcomeKnown: true,
        httpStatus: 401,
      },
      revoke: null,
      vapidRejected: true,
    });
    expect(
      pushDecisionFromSubmission({
        kind: 'rejected',
        code: 'PROVIDER_429',
        httpStatus: 429,
        vapidRejected: false,
      }).result.failureCode,
    ).toBe('PROVIDER_429');
  });

  it('keeps an unknown answer unknown', () => {
    expect(
      pushDecisionFromSubmission({
        kind: 'unknown',
        code: 'PROVIDER_5XX',
        outcomeKnown: false,
        httpStatus: 503,
      }),
    ).toEqual({
      result: {
        status: 'FAILED',
        failureCode: 'PROVIDER_5XX',
        outcomeKnown: false,
        httpStatus: 503,
      },
      revoke: null,
      vapidRejected: false,
    });
    expect(
      pushDecisionFromSubmission({
        kind: 'unknown',
        code: 'NETWORK_UNKNOWN',
        outcomeKnown: false,
        httpStatus: null,
      }).result.outcomeKnown,
    ).toBe(false);
  });
});

describe('the expired and refused answers', () => {
  it('turns an expired or a refused answer into a local failure', () => {
    expect(pushDecisionFromSubmission({ kind: 'expired' }).result).toEqual({
      status: 'EXPIRED',
      failureCode: 'DEADLINE_EXPIRED',
      outcomeKnown: true,
      httpStatus: null,
    });
    expect(
      pushDecisionFromSubmission({ kind: 'refused', code: 'CAPABILITY_UNAVAILABLE' }).result,
    ).toEqual({
      status: 'FAILED',
      failureCode: 'CONFIG_INVALID',
      outcomeKnown: true,
      httpStatus: null,
    });
  });
});

describe('the invalid endpoint decision', () => {
  it('fails the attempt as gone and asks for the subscription to be revoked', () => {
    expect(invalidEndpointDecision()).toEqual({
      result: {
        status: 'FAILED',
        failureCode: 'SUBSCRIPTION_GONE',
        outcomeKnown: true,
        httpStatus: null,
      },
      revoke: 'GONE',
      vapidRejected: false,
    });
  });
});

describe('refusedDecision', () => {
  it('builds a known local failure for every code', () => {
    expect(refusedDecision('PARAMETERS_INVALID')).toEqual({
      result: {
        status: 'FAILED',
        failureCode: 'PARAMETERS_INVALID',
        outcomeKnown: true,
        httpStatus: null,
      },
      revoke: null,
      vapidRejected: false,
    });
    expect(refusedDecision('ADMISSION_REFUSED').result.status).toBe('FAILED');
    expect(refusedDecision('DEADLINE_EXPIRED').result.status).toBe('EXPIRED');
  });
});
