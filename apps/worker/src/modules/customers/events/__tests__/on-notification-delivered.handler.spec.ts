import { describe, expect, it } from 'vitest';

import type { ClaimedEvent, Tx } from '@pospay/db';

import { RecordRatingRequestSent } from '../../use-cases/record-rating-request-sent/record-rating-request-sent.ts';
import { onNotificationDelivered } from '../handlers/on-notification-delivered.handler.ts';

const COMPANY = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const ATTEMPT = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const READY = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2d';
const OCCURRED = '2026-06-01T14:05:00.000Z';

const payload = {
  company_id: COMPANY,
  attempt_id: ATTEMPT,
  source_event_id: READY,
  business_id: null,
  branch_id: null,
  channel: 'whatsapp',
  template_key: 'rating_request',
  locale: 'ar',
  status: 'SENT',
  occurred_at: OCCURRED,
  evidence: 'PROVIDER_ACCEPTED',
  outcome_known: true,
};

function eventOf(overrides: Partial<ClaimedEvent> & { payload?: unknown } = {}): ClaimedEvent {
  return {
    companyId: COMPANY,
    id: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2e',
    aggregateType: 'notification_attempt',
    aggregateId: ATTEMPT,
    eventType: 'NotificationDelivered',
    payload,
    attempt: 1,
    ...overrides,
  };
}

function harness() {
  const calls: unknown[][] = [];
  const repository = {
    markSent: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  };
  return { calls, useCase: new RecordRatingRequestSent<Tx>(repository) };
}

const tx = {} as Tx;

describe('onNotificationDelivered', () => {
  it('moves the request by the ready event id at the acceptance time', async () => {
    const { calls, useCase } = harness();
    await onNotificationDelivered(useCase, tx, eventOf());
    expect(calls).toEqual([[tx, COMPANY, READY, new Date(OCCURRED)]]);
  });

  it.each([
    {
      name: 'an in-app delivery',
      patch: { channel: 'IN_APP', recipient_user_id: COMPANY, evidence: 'IN_APP_STORED' },
    },
    { name: 'an email delivery', patch: { channel: 'email' } },
    { name: 'another WhatsApp template', patch: { template_key: 'staff_otp' } },
    { name: 'a FAILED rating result', patch: { status: 'FAILED', failure_code: 'PROVIDER_4XX' } },
  ])('ignores $name without touching any request', async ({ patch }) => {
    const { calls, useCase } = harness();
    await onNotificationDelivered(useCase, tx, eventOf({ payload: { ...payload, ...patch } }));
    expect(calls).toEqual([]);
  });

  it('ignores a payload of another shape instead of parking it', async () => {
    const { calls, useCase } = harness();
    await onNotificationDelivered(useCase, tx, eventOf({ payload: 'opaque' }));
    expect(calls).toEqual([]);
  });

  it.each([
    {
      name: 'a malformed rating payload',
      event: eventOf({ payload: { ...payload, attempt_id: 'x' } }),
    },
    { name: 'a foreign aggregate', event: eventOf({ aggregateType: 'rating' }) },
    { name: 'another attempt id', event: eventOf({ aggregateId: READY }) },
    { name: 'another company', event: eventOf({ companyId: ATTEMPT }) },
  ])('rejects $name', async ({ event }) => {
    const { calls, useCase } = harness();
    await expect(onNotificationDelivered(useCase, tx, event)).rejects.toThrow(
      'RATING_SENT_EVENT_INVALID',
    );
    expect(calls).toEqual([]);
  });
});
