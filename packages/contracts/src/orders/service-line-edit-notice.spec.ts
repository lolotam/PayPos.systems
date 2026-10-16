import { expect, it } from 'vitest';
import { serviceLineEditNoticeRequested } from './service-line-edit-notice.js';
import { notificationRequest } from '../notifications.js';
import { inAppNotification } from '../in-app-notifications.js';
const id = '01920000-0000-7000-8000-000000004005';
const parameters = [
  { name: 'service_name_ar', type: 'text', value: 'قص' },
  { name: 'service_name_en', type: 'text', value: 'Cut' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'business_date', type: 'text', value: '2026-10-16' },
  { name: 'previous_net', type: 'text', value: '25.000' },
  { name: 'new_net', type: 'text', value: '20.000' },
  { name: 'editor_name_ar', type: 'text', value: 'ليلى' },
  { name: 'editor_name_en', type: 'text', value: 'Laila' },
];
const recipient = {
  channel: 'IN_APP',
  user_id: id,
  locale: 'ar',
  template_key: 'service_line_price_edited',
  template_revision: 1,
  safe_parameters: parameters,
};
const notice = {
  schema_version: 1,
  session_id: id,
  line_id: id,
  revision: 2,
  business_id: id,
  branch_id: id,
  business_date: '2026-10-16',
  business_timezone: 'Asia/Kuwait',
  notification_recipients: [recipient],
};
const withMoney = (previous: string, next: string) => ({
  ...notice,
  notification_recipients: [
    {
      ...recipient,
      safe_parameters: parameters.map((parameter) =>
        parameter.name === 'previous_net'
          ? { ...parameter, value: previous }
          : parameter.name === 'new_net'
            ? { ...parameter, value: next }
            : parameter,
      ),
    },
  ],
});
it('strict new notice fits existing notification request and inbox schemas', () => {
  expect(serviceLineEditNoticeRequested.safeParse(notice).success).toBe(true);
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
      created_at: '2026-10-16T08:00:00.000Z',
      read_at: null,
    }).success,
  ).toBe(true);
});
it.each(['2.500', '125.000', '1250.000'])('canonical bell money %s parses on the request and the stored row', (amount) => {
  const candidate = withMoney(amount, amount);
  expect(notificationRequest.safeParse(candidate).success).toBe(true);
  expect(
    inAppNotification.safeParse({
      id,
      company_id: id,
      business_id: id,
      branch_id: id,
      source_event_id: id,
      template_key: 'service_line_price_edited',
      template_revision: 1,
      locale: 'en',
      safe_parameters: candidate.notification_recipients[0]?.safe_parameters,
      created_at: '2026-10-16T08:00:00.000Z',
      read_at: null,
    }).success,
  ).toBe(true);
});
it.each(['2.5', '1250', '1250.0000', '+96500000001', 'https://example.test', '-1.000', '+1.000'])(
  'non-canonical money %s is rejected',
  (amount) => {
    expect(notificationRequest.safeParse(withMoney(amount, '20.000')).success).toBe(false);
    expect(inAppNotification.safeParse({
      id, company_id: id, business_id: id, branch_id: id, source_event_id: id,
      template_key: 'service_line_price_edited', template_revision: 1, locale: 'ar',
      safe_parameters: withMoney(amount, '20.000').notification_recipients[0]?.safe_parameters,
      created_at: '2026-10-16T08:00:00.000Z', read_at: null,
    }).success).toBe(false);
  },
);
it('no unknown fields, empty/oversized groups, wrong channel/revision/locale, low revision or invalid date', () => {
  for (const candidate of [
    { ...notice, phone: 'Synthetic' },
    { ...notice, notification_recipients: [] },
    { ...notice, notification_recipients: Array(101).fill(recipient) },
    { ...notice, business_date: '2026-02-29' },
    { ...notice, revision: 1 },
    ...[
      { locale: 'en' },
      { template_revision: 2 },
      { channel: 'email' },
      { template_key: 'generic_notice' },
    ].map((value) => ({ ...notice, notification_recipients: [{ ...recipient, ...value }] })),
  ])
    expect(serviceLineEditNoticeRequested.safeParse(candidate).success).toBe(false);
});
it.each(['٩٩٩ ٩٩٩ ٩٩٨ ١٢٣', '+999999998123', 'https://example.test', 'example.test'])(
  'unsafe display name %s is rejected at the contract boundary',
  (value) => {
    expect(
      serviceLineEditNoticeRequested.safeParse({
        ...notice,
        notification_recipients: [
          { ...recipient, safe_parameters: [{ ...parameters[0], value }, ...parameters.slice(1)] },
        ],
      }).success,
    ).toBe(false);
  },
);
