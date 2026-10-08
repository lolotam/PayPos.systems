import { expect, it } from 'vitest';

import { inAppRecipient, notificationRequest, notificationResult } from '../index.js';

const recipient = {
  channel: 'IN_APP',
  user_id: '01920000-0000-7000-8000-0000000000f1',
  template_key: 'generic_notice',
  template_revision: 1,
  locale: 'en',
  safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
};

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
      { name: 'employee_name', type: 'text', value: 'Synthetic employee' },
      { name: 'branch_name', type: 'text', value: 'Synthetic branch' },
      { name: 'shift_start', type: 'text', value: '10:00' },
    ],
  };
  expect(inAppRecipient.parse(shift)).toEqual(shift);
  expect(notificationRequest.safeParse({ notification_recipients: [shift] }).success).toBe(true);
  expect(
    inAppRecipient.safeParse({
      ...shift,
      safe_parameters: [
        { name: 'employee_name', type: 'text', value: '123456' },
        shift.safe_parameters[1],
        shift.safe_parameters[2],
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
