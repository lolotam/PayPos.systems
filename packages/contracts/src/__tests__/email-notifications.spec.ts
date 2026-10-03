import { expect, it } from 'vitest';
import { notificationRequest, notificationResult, deliveryLogItem } from '../notifications.js';

const ID = '01920000-0000-7000-8000-000000000001';
const recipient = {
  channel: 'email',
  email: 'synthetic.owner@example.invalid',
  locale: 'ar',
  template_key: 'document_expiring',
  template_revision: 1,
  safe_parameters: [],
};
it('requires one email destination without phone/body/credentials on its strict recipient', () => {
  expect(notificationRequest.safeParse({ notification_recipients: [recipient] }).success).toBe(
    true,
  );
  for (const extra of [
    { phone: '+96500000001' },
    { body: 'private body' },
    { api_key: 'synthetic' },
  ])
    expect(
      notificationRequest.safeParse({ notification_recipients: [{ ...recipient, ...extra }] })
        .success,
    ).toBe(false);
});
it('retains explicit locale failures for processing without falling back', () => {
  for (const locale of [null, 'fr'])
    expect(
      notificationRequest.parse({ notification_recipients: [{ ...recipient, locale }] })
        .notification_recipients[0]?.locale,
    ).toBe(locale);
});
it('email result evidence contains only context and finite diagnostics', () => {
  const result = {
    company_id: ID,
    attempt_id: ID,
    source_event_id: ID,
    business_id: null,
    branch_id: null,
    channel: 'email',
    template_key: 'document_expiring',
    locale: 'en',
    status: 'SENT',
    occurred_at: '2026-10-03T00:00:00Z',
    evidence: 'PROVIDER_ACCEPTED',
    outcome_known: true,
  };
  expect(notificationResult.safeParse(result).success).toBe(true);
  expect(notificationResult.safeParse({ ...result, email: recipient.email }).success).toBe(false);
  expect(notificationResult.safeParse({ ...result, evidence: 'IN_APP_STORED' }).success).toBe(
    false,
  );
});
it('delivery log suffix is NULL for email and required for WhatsApp', () => {
  const row = {
    id: ID,
    company_id: ID,
    source_event_id: ID,
    business_id: null,
    branch_id: null,
    channel: 'email',
    template_key: 'document_expiring',
    template_revision: 1,
    locale: 'en',
    phone_last3: null,
    status: 'FAILED',
    authorized_at: '2026-10-03T00:00:00Z',
    send_deadline: null,
    sending_at: null,
    finished_at: null,
    provider_message_id: null,
    failure_code: 'CONFIG_INVALID',
    outcome_known: true,
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
  };
  expect(deliveryLogItem.safeParse(row).success).toBe(true);
  expect(deliveryLogItem.safeParse({ ...row, phone_last3: '001' }).success).toBe(false);
  expect(deliveryLogItem.safeParse({ ...row, channel: 'whatsapp' }).success).toBe(false);
});
