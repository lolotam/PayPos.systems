import { describe, expect, it } from 'vitest';

import {
  RATING_REQUEST_TEMPLATE_KEY,
  RATING_REQUEST_TEMPLATE_REVISION,
  ratingRequestReady,
} from '../customers/rating-request-ready.js';
import { ratingClaimsDiscoveryRequested, ratingClaimsJob } from '../customers/rating-claims.js';
import { notificationRequest } from '../notifications.js';

const eventId = '01920000-0000-7000-8000-0000000000a1';
const companyId = '01920000-0000-7000-8000-0000000000b2';
const businessId = '01920000-0000-7000-8000-0000000000c3';
const branchId = '01920000-0000-7000-8000-0000000000d4';
const requestId = '01920000-0000-7000-8000-0000000000e5';

const payload = {
  event_id: eventId,
  company_id: companyId,
  business_id: businessId,
  branch_id: branchId,
  rating_request_id: requestId,
  token_key_version: 1,
  notification_recipients: [
    {
      phone: '+96550000000',
      locale: 'ar',
      channel: 'whatsapp' as const,
      template_key: RATING_REQUEST_TEMPLATE_KEY,
      template_revision: RATING_REQUEST_TEMPLATE_REVISION,
      safe_parameters: [
        { name: 'business_name', type: 'text' as const, value: 'مطعم البحر' },
        { name: 'performers', type: 'text' as const, value: 'فريق مطعم البحر' },
        { name: 'rating_request_id', type: 'text' as const, value: requestId },
      ],
      send_deadline: '2026-10-31T12:00:00.000Z',
    },
  ],
};

describe('rating request ready contract', () => {
  it('accepts the ready payload of one whatsapp recipient', () => {
    const parsed = ratingRequestReady.parse(payload);
    expect(parsed.rating_request_id).toBe(requestId);
    expect(parsed.notification_recipients).toHaveLength(1);
  });

  it('is readable by the notification consumer without a change on its side', () => {
    expect(notificationRequest.safeParse(payload).success).toBe(true);
  });

  it('refuses a payload without the request identity', () => {
    expect(ratingRequestReady.safeParse({ ...payload, rating_request_id: undefined }).success).toBe(
      false,
    );
  });

  it('refuses a payload without the key version', () => {
    expect(
      ratingRequestReady.safeParse({ ...payload, token_key_version: undefined }).success,
    ).toBe(false);
  });

  it('refuses more than one recipient', () => {
    expect(
      ratingRequestReady.safeParse({
        ...payload,
        notification_recipients: [...payload.notification_recipients, payload.notification_recipients[0]],
      }).success,
    ).toBe(false);
  });

  it('refuses a payload that carries the token itself', () => {
    expect(
      ratingRequestReady.safeParse({ ...payload, token: 'company.token' }).success,
    ).toBe(false);
  });

  it('refuses a key version that is not positive', () => {
    expect(ratingRequestReady.safeParse({ ...payload, token_key_version: 0 }).success).toBe(false);
  });
});

describe('rating claims discovery contract', () => {
  it('carries the company identity only', () => {
    expect(ratingClaimsDiscoveryRequested.parse({ company_id: companyId })).toEqual({
      company_id: companyId,
    });
  });

  it('refuses a payload with anything else', () => {
    expect(ratingClaimsDiscoveryRequested.safeParse({ company_id: companyId, id: requestId }).success).toBe(
      false,
    );
  });
});

describe('rating claims job contract', () => {
  it('carries the company identity only', () => {
    expect(ratingClaimsJob.parse({ companyId })).toEqual({ companyId });
  });

  it('refuses a job with anything else', () => {
    expect(ratingClaimsJob.safeParse({ companyId, requestId }).success).toBe(false);
  });
});
