import { expect, it } from 'vitest';

import {
  notificationRecipient,
  notificationRequest,
  notificationResult,
  pushRecipient,
  pushSendAuthorized,
} from '../notifications.js';

const ID = '01920000-0000-7000-8000-000000000001';
const OTHER_ID = '01920000-0000-7000-8000-000000000002';
const push = {
  channel: 'PUSH',
  user_id: ID,
  template_key: 'shift_not_clocked_in_self',
  template_revision: 1,
  safe_parameters: [
    { name: 'shift_start', type: 'text', value: '10:00' },
    { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  ],
};

it('accepts a push recipient that names only the user and the template', () => {
  expect(pushRecipient.parse(push)).toEqual(push);
  const request = notificationRequest.parse({ notification_recipients: [push] });
  expect(request.notification_recipients).toHaveLength(1);
});

it('refuses a push recipient that carries a destination or a language', () => {
  for (const extra of [
    { phone: '+96500000001' },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic' },
    { locale: 'ar' },
    { p256dh: 'p'.repeat(87) },
    { delivery_token: ID },
  ])
    expect(pushRecipient.safeParse({ ...push, ...extra }).success).toBe(false);
});

it('keeps the phone, email and in-app recipients parsing beside the push one', () => {
  const whatsapp = {
    channel: 'whatsapp',
    phone: '+96500000001',
    locale: 'ar',
    template_key: 'document_expiring',
    template_revision: 1,
    safe_parameters: [],
  };
  const email = {
    channel: 'email',
    email: 'synthetic.owner@example.invalid',
    locale: 'ar',
    template_key: 'document_expiring',
    template_revision: 1,
    safe_parameters: [],
  };
  const inApp = {
    channel: 'IN_APP',
    user_id: ID,
    locale: 'ar',
    template_key: 'generic_notice',
    template_revision: 1,
    safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
  };
  for (const recipient of [whatsapp, email, inApp, push]) {
    expect(notificationRecipient.safeParse(recipient).success).toBe(true);
    expect(notificationRequest.safeParse({ notification_recipients: [recipient] }).success).toBe(
      true,
    );
  }
  expect(
    notificationRecipient.safeParse({ ...push, channel: 'PUSH', user_id: 'not-a-uuid' }).success,
  ).toBe(false);
});

it('publishes the push authorization with the company and the attempt only', () => {
  expect(pushSendAuthorized.parse({ company_id: ID, attempt_id: ID })).toEqual({
    company_id: ID,
    attempt_id: ID,
  });
  const withEndpoint = { company_id: ID, attempt_id: ID, endpoint: 'https://x.test' };
  expect(pushSendAuthorized.safeParse(withEndpoint).success).toBe(false);
});

it('takes one hundred recipients and refuses one hundred and one', () => {
  const group = Array.from({ length: 100 }, () => push);
  expect(notificationRequest.safeParse({ notification_recipients: group }).success).toBe(true);
  expect(notificationRequest.safeParse({ notification_recipients: [...group, push] }).success).toBe(
    false,
  );
});

it('carries a push terminal result without a recipient user', () => {
  const result = {
    company_id: ID,
    attempt_id: ID,
    source_event_id: ID,
    business_id: null,
    branch_id: null,
    channel: 'PUSH',
    template_key: 'shift_not_clocked_in_self',
    locale: 'ar',
    status: 'EXPIRED',
    occurred_at: '2026-10-23T10:00:00Z',
    evidence: 'NONE',
    failure_code: 'DEADLINE_EXPIRED',
    outcome_known: true,
  };
  expect(notificationResult.parse(result)).toEqual(result);
  expect(notificationResult.safeParse({ ...result, recipient_user_id: ID }).success).toBe(false);
});

it('carries every push failure code of a push attempt', () => {
  const codes = [
    'DEADLINE_EXPIRED',
    'SUBSCRIPTION_GONE',
    'SUBSCRIPTION_CHANGED',
    'SUBSCRIPTION_REVOKED',
    'KEY_ROTATED',
    'ADMISSION_REFUSED',
    'VAPID_REJECTED',
    'PROVIDER_4XX',
    'PROVIDER_429',
    'PROVIDER_5XX',
    'NETWORK_UNKNOWN',
  ];
  const base = {
    company_id: ID,
    attempt_id: ID,
    source_event_id: ID,
    business_id: null,
    branch_id: null,
    channel: 'PUSH',
    template_key: 'shift_not_clocked_in_self',
    locale: 'ar',
    status: 'FAILED',
    occurred_at: '2026-10-23T10:00:00Z',
    evidence: 'NONE',
    outcome_known: true,
  };
  for (const failure_code of codes)
    expect(notificationResult.safeParse({ ...base, failure_code }).success).toBe(true);
  expect(notificationResult.safeParse({ ...base, failure_code: 'NOT_A_CODE' }).success).toBe(false);
});

it('keeps the employee push in a request of its own', () => {
  const inApp = {
    channel: 'IN_APP',
    user_id: ID,
    locale: 'ar',
    template_key: 'generic_notice',
    template_revision: 1,
    safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
  };
  const whatsapp = {
    channel: 'whatsapp',
    phone: '+96500000001',
    locale: 'ar',
    template_key: 'document_expiring',
    template_revision: 1,
    safe_parameters: [],
  };
  expect(notificationRequest.safeParse({ notification_recipients: [push, inApp] }).success).toBe(
    false,
  );
  expect(notificationRequest.safeParse({ notification_recipients: [push, whatsapp] }).success).toBe(
    false,
  );
  expect(
    notificationRequest.safeParse({
      notification_recipients: [push, { ...push, user_id: OTHER_ID }],
    }).success,
  ).toBe(true);
  expect(
    notificationRequest.safeParse({ notification_recipients: [inApp, whatsapp] }).success,
  ).toBe(true);
});
