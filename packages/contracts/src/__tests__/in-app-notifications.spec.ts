import { expect, it } from 'vitest';

import { inAppRecipient, notificationRequest, notificationResult } from '../index.js';
import { shiftNotClockedInParameters } from '../in-app-notifications.js';

const recipient = {
  channel: 'IN_APP',
  user_id: '01920000-0000-7000-8000-0000000000f1',
  template_key: 'generic_notice',
  template_revision: 1,
  locale: 'en',
  safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
};

it.each([
  '123456',
  ' 123456 ',
  'https://example.test/private',
  'www.example.test',
  'example.test',
  '+96500000001',
  '00000001',
  '0000 0001',
  '٠٠٠٠ ٠٠٠١',
  'Synthetic 00000001',
  ' ',
])('rejects unsafe display names: %s', (value) => {
  const parameters = [
    'employee_name_ar',
    'employee_name_en',
    'branch_name_ar',
    'branch_name_en',
  ].map((name) => ({ name, type: 'text', value }));
  expect(
    shiftNotClockedInParameters.safeParse([
      ...parameters,
      { name: 'shift_start', type: 'text', value: '10:00' },
    ]).success,
  ).toBe(false);
});

it('discriminates user recipients from unchanged WhatsApp phone recipients', () => {
  expect(inAppRecipient.parse(recipient)).toEqual(recipient);
  expect(notificationRequest.safeParse({ notification_recipients: [recipient] }).success).toBe(
    true,
  );
  expect(inAppRecipient.safeParse({ ...recipient, phone: '+96500000001' }).success).toBe(false);
  expect(inAppRecipient.safeParse({ ...recipient, template_key: 'staff_otp' }).success).toBe(false);
  const shift = {
    channel: 'IN_APP',
    user_id: recipient.user_id,
    template_key: 'shift_not_clocked_in',
    template_revision: 1,
    locale: 'ar',
    safe_parameters: [
      { name: 'employee_name_ar', type: 'text', value: 'Synthetic employee' },
      { name: 'employee_name_en', type: 'text', value: 'Synthetic employee' },
      { name: 'branch_name_ar', type: 'text', value: 'Studio 2026' },
      { name: 'branch_name_en', type: 'text', value: 'Studio 2026' },
      { name: 'shift_start', type: 'text', value: '10:00' },
    ],
  };
  expect(inAppRecipient.parse(shift)).toEqual(shift);
  expect(notificationRequest.safeParse({ notification_recipients: [shift] }).success).toBe(true);
  expect(
    inAppRecipient.safeParse({
      ...shift,
      safe_parameters: [
        { name: 'employee_name_ar', type: 'text', value: '123456' },
        ...shift.safe_parameters.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    inAppRecipient.safeParse({
      ...shift,
      safe_parameters: [
        shift.safe_parameters[0],
        shift.safe_parameters[1],
        { name: 'branch_name_ar', type: 'text', value: 'https://example.test/private' },
        ...shift.safe_parameters.slice(3),
      ],
    }).success,
  ).toBe(false);
  expect(
    inAppRecipient.safeParse({
      ...recipient,
      safe_parameters: [{ name: 'subject', type: 'text', value: 'token secret' }],
    }).success,
  ).toBe(false);
});

it('shares the result envelope without exposing parameters or a destination', () => {
  const result = {
    company_id: recipient.user_id,
    attempt_id: recipient.user_id,
    source_event_id: recipient.user_id,
    recipient_user_id: recipient.user_id,
    business_id: null,
    branch_id: null,
    channel: 'IN_APP',
    template_key: 'generic_notice',
    locale: 'en',
    status: 'SENT',
    evidence: 'IN_APP_STORED',
    occurred_at: '2026-10-01T12:00:00Z',
    outcome_known: true,
  };
  expect(notificationResult.parse(result)).toEqual(result);
  expect(
    notificationResult.safeParse({ ...result, safe_parameters: recipient.safe_parameters }).success,
  ).toBe(false);
});

it('accepts the break_not_returned in-app recipient with a break end only', () => {
  const names = [
    { name: 'employee_name_ar', type: 'text', value: 'Synthetic employee' },
    { name: 'employee_name_en', type: 'text', value: 'Synthetic employee' },
    { name: 'branch_name_ar', type: 'text', value: 'Studio 2026' },
    { name: 'branch_name_en', type: 'text', value: 'Studio 2026' },
  ];
  const breakAlert = {
    ...recipient,
    template_key: 'break_not_returned',
    safe_parameters: [...names, { name: 'break_end', type: 'text', value: '14:00' }],
  };
  expect(inAppRecipient.parse(breakAlert)).toEqual(breakAlert);
  expect(notificationRequest.safeParse({ notification_recipients: [breakAlert] }).success).toBe(
    true,
  );
  for (const last of [
    { name: 'shift_start', type: 'text', value: '14:00' },
    { name: 'break_end', type: 'text', value: '24:00' },
  ])
    expect(
      inAppRecipient.safeParse({ ...breakAlert, safe_parameters: [...names, last] }).success,
    ).toBe(false);
});
