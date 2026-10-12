import { expect, it } from 'vitest';
import { lateServiceSessionNoticeRequested } from './late-service-session-notice.js';
import { notificationRequest } from '../notifications.js';
import { inAppNotification } from '../in-app-notifications.js';
const id = '01920000-0000-7000-8000-000000004005';
const parameters = [
  { name: 'branch_name_ar', type: 'text', value: 'فرع' },
  { name: 'branch_name_en', type: 'text', value: 'Branch' },
  { name: 'business_date', type: 'text', value: '2026-10-14' },
];
const recipient = {
  channel: 'IN_APP',
  user_id: id,
  locale: 'ar',
  template_key: 'late_service_session',
  template_revision: 1,
  safe_parameters: parameters,
};
const notice = {
  schema_version: 1,
  session_id: id,
  business_id: id,
  branch_id: id,
  business_date: '2026-10-14',
  business_timezone: 'Asia/Kuwait',
  notification_recipients: [recipient],
};
it('strict new notice fits existing notification request and inbox schemas', () => {
  expect(lateServiceSessionNoticeRequested.safeParse(notice).success).toBe(true);
  expect(notificationRequest.safeParse(notice).success).toBe(true);
  expect(
    inAppNotification.safeParse({
      id,
      company_id: id,
      business_id: id,
      branch_id: id,
      source_event_id: id,
      template_key: recipient.template_key,
      template_revision: 1,
      locale: 'ar',
      safe_parameters: parameters,
      created_at: '2026-10-15T08:00:00.000Z',
      read_at: null,
    }).success,
  ).toBe(true);
});
it('no unknown fields, empty/oversized groups, wrong channel/revision/default locale or invalid calendar date', () => {
  for (const candidate of [
    { ...notice, phone: 'Synthetic' },
    { ...notice, notification_recipients: [] },
    { ...notice, notification_recipients: Array(101).fill(recipient) },
    { ...notice, business_date: '2026-02-29' },
    ...[
      { locale: 'en' },
      { template_revision: 2 },
      { channel: 'email' },
      { template_key: 'generic_notice' },
    ].map((value) => ({ ...notice, notification_recipients: [{ ...recipient, ...value }] })),
  ])
    expect(lateServiceSessionNoticeRequested.safeParse(candidate).success).toBe(false);
});
it.each(['٩٩٩ ٩٩٩ ٩٩٨ ١٢٣', '+999999998123', 'example.test', '1234', 'otp'])(
  'unsafe display name %s is rejected at the contract boundary',
  (value) => {
    expect(
      lateServiceSessionNoticeRequested.safeParse({
        ...notice,
        notification_recipients: [
          { ...recipient, safe_parameters: [{ ...parameters[0], value }, ...parameters.slice(1)] },
        ],
      }).success,
    ).toBe(false);
  },
);
