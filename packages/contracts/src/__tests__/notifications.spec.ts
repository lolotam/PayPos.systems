import { expect, it } from 'vitest';

import {
  notificationRecipient,
  notificationRequest,
  pushRecipient,
  pushSendAuthorized,
} from '../notifications.js';

const ID = '01920000-0000-7000-8000-000000000001';
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
