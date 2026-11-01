import { describe, expect, it } from 'vitest';

import {
  RATING_REQUEST_TEMPLATE_KEY,
  RATING_REQUEST_TEMPLATE_REVISION,
  ratingRequestReady,
} from '../customers/rating-request-ready.js';
import { notificationRequest } from '../notifications.js';

const eventId = '01920000-0000-7000-8000-0000000000a1';
const companyId = '01920000-0000-7000-8000-0000000000b2';
const businessId = '01920000-0000-7000-8000-0000000000c3';
const branchId = '01920000-0000-7000-8000-0000000000d4';
const requestId = '01920000-0000-7000-8000-0000000000e5';

const recipient = {
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
};

const payload = {
  event_id: eventId,
  company_id: companyId,
  business_id: businessId,
  branch_id: branchId,
  rating_request_id: requestId,
  token_key_version: 1,
  notification_recipients: [recipient],
};

/** نفس الحمولة، بس بمعاملات آمنة بأسماء محددة. */
const withParameters = (names: readonly string[]) => ({
  ...payload,
  notification_recipients: [
    {
      ...recipient,
      safe_parameters: names.map((name) => ({
        name,
        type: 'text' as const,
        value: `${name}-value`,
      })),
    },
  ],
});

/** نفس الحمولة، بس بحقل واحد في المستقبل متغيّر. */
const withRecipient = (field: Record<string, unknown>) => ({
  ...payload,
  notification_recipients: [{ ...recipient, ...field }],
});

describe('rating request ready contract', () => {
  it('accepts the ready payload of one whatsapp recipient', () => {
    const parsed = ratingRequestReady.parse(payload);
    expect(parsed.rating_request_id).toBe(requestId);
    expect(parsed.notification_recipients).toHaveLength(1);
  });

  it('is readable by the notification consumer without a change on its side', () => {
    expect(notificationRequest.safeParse(payload).success).toBe(true);
  });

  it('refuses a payload without a business id', () => {
    expect(ratingRequestReady.safeParse({ ...payload, business_id: undefined }).success).toBe(
      false,
    );
  });

  it('refuses a payload without a rating request id', () => {
    expect(ratingRequestReady.safeParse({ ...payload, rating_request_id: undefined }).success).toBe(
      false,
    );
  });

  it('refuses a payload without a token key version', () => {
    expect(ratingRequestReady.safeParse({ ...payload, token_key_version: undefined }).success).toBe(
      false,
    );
  });

  it('refuses a payload that carries the token itself', () => {
    expect(ratingRequestReady.safeParse({ ...payload, token: 'company.token' }).success).toBe(
      false,
    );
  });

  it('refuses a key version that is not positive', () => {
    expect(ratingRequestReady.safeParse({ ...payload, token_key_version: 0 }).success).toBe(false);
  });
});

describe('the safe parameters of the rating request', () => {
  it('accepts the customer first name next to the required ones', () => {
    expect(
      ratingRequestReady.safeParse(
        withParameters(['customer_first_name', 'business_name', 'performers', 'rating_request_id']),
      ).success,
    ).toBe(true);
  });

  it('accepts the required ones without the customer first name', () => {
    expect(
      ratingRequestReady.safeParse(
        withParameters(['business_name', 'performers', 'rating_request_id']),
      ).success,
    ).toBe(true);
  });

  it('refuses a token parameter', () => {
    expect(
      ratingRequestReady.safeParse(
        withParameters(['business_name', 'performers', 'rating_request_id', 'token']),
      ).success,
    ).toBe(false);
  });

  it('refuses a duplicated parameter name', () => {
    expect(
      ratingRequestReady.safeParse(
        withParameters(['business_name', 'business_name', 'performers', 'rating_request_id']),
      ).success,
    ).toBe(false);
  });

  it('refuses an unknown parameter name', () => {
    expect(
      ratingRequestReady.safeParse(
        withParameters(['business_name', 'performers', 'rating_request_id', 'customer_phone']),
      ).success,
    ).toBe(false);
  });

  it('refuses a missing required parameter name', () => {
    expect(
      ratingRequestReady.safeParse(withParameters(['business_name', 'performers'])).success,
    ).toBe(false);
  });
});

describe('the pinned fields of the rating request recipient', () => {
  it('refuses another template key', () => {
    expect(
      ratingRequestReady.safeParse(withRecipient({ template_key: 'rating_request_v2' })).success,
    ).toBe(false);
  });

  it('refuses another template revision', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ template_revision: 2 })).success).toBe(
      false,
    );
  });

  it('refuses an unsupported locale', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ locale: 'fr' })).success).toBe(false);
  });

  it('refuses a null locale', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ locale: null })).success).toBe(false);
  });

  it('refuses a missing locale', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ locale: undefined })).success).toBe(false);
  });

  it('refuses a phone that is not E.164', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ phone: '96550000000' })).success).toBe(
      false,
    );
    expect(ratingRequestReady.safeParse(withRecipient({ phone: '+0123' })).success).toBe(false);
    expect(
      ratingRequestReady.safeParse(withRecipient({ phone: '+1234567890123456' })).success,
    ).toBe(false);
  });

  it('accepts a phone at the shortest length the database allows', () => {
    expect(ratingRequestReady.safeParse(withRecipient({ phone: '+12' })).success).toBe(true);
    expect(ratingRequestReady.safeParse(withRecipient({ phone: '+96550000000' })).success).toBe(
      true,
    );
  });
});
