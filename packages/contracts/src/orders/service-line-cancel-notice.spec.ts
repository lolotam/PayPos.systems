import { expect, it } from 'vitest';
import { serviceLineCancelNoticeRequested } from './service-line-cancel-notice.js';
import { notificationRequest } from '../notifications.js';
import { inAppNotification } from '../in-app-notifications.js';
const id = '01920000-0000-7000-8000-000000004005';
const parameters = [
  { name: 'service_name_ar', type: 'text', value: 'قص' },
  { name: 'service_name_en', type: 'text', value: 'Cut' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'business_date', type: 'text', value: '2026-10-16' },
  { name: 'cancelled_net', type: 'text', value: '20.000' },
];
const recipient = {
  channel: 'IN_APP',
  user_id: id,
  locale: 'ar',
  template_key: 'service_line_cancelled',
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
const stored = {
  id,
  company_id: id,
  business_id: id,
  branch_id: id,
  source_event_id: id,
  template_key: recipient.template_key,
  template_revision: 1,
  locale: 'ar' as const,
  safe_parameters: parameters,
  created_at: '2026-10-16T08:00:00.000Z',
  read_at: null,
};
it('strict cancel notice fits existing notification request and inbox schemas', () => {
  expect(serviceLineCancelNoticeRequested.safeParse(notice).success).toBe(true);
  expect(notificationRequest.safeParse(notice).success).toBe(true);
  expect(inAppNotification.safeParse(stored).success).toBe(true);
});
it.each(['2.500', '125.000', '1250.000'])('canonical cancelled net %s parses', (amount) => {
  const safe_parameters = parameters.map((parameter) =>
    parameter.name === 'cancelled_net' ? { ...parameter, value: amount } : parameter,
  );
  const candidate = { ...notice, notification_recipients: [{ ...recipient, safe_parameters }] };
  expect(notificationRequest.safeParse(candidate).success).toBe(true);
  expect(inAppNotification.safeParse({ ...stored, locale: 'en', safe_parameters }).success).toBe(
    true,
  );
});
it('rejects an empty group, an oversized group and an unknown field', () => {
  for (const candidate of [
    { ...notice, notification_recipients: [] },
    { ...notice, notification_recipients: Array(101).fill(recipient) },
    { ...notice, phone: 'Synthetic' },
    { ...notice, reason: 'complained' },
  ])
    expect(serviceLineCancelNoticeRequested.safeParse(candidate).success).toBe(false);
});
it('rejects an identity or reason parameter', () => {
  const withParameter = (
    safe_parameters: ReadonlyArray<{ name: string; type: string; value: string }>,
  ) => ({
    ...notice,
    notification_recipients: [{ ...recipient, safe_parameters }],
  });
  expect(
    serviceLineCancelNoticeRequested.safeParse(
      withParameter([...parameters, { name: 'canceller_name_ar', type: 'text', value: 'ليلى' }]),
    ).success,
  ).toBe(false);
  expect(
    serviceLineCancelNoticeRequested.safeParse(
      withParameter(
        parameters.map((parameter, index) =>
          index === 0 ? { ...parameter, name: 'reason' } : parameter,
        ),
      ),
    ).success,
  ).toBe(false);
  expect(
    serviceLineCancelNoticeRequested.safeParse(
      withParameter(
        parameters.map((parameter) =>
          parameter.name === 'service_name_en'
            ? { ...parameter, name: 'canceller_name_en' }
            : parameter,
        ),
      ),
    ).success,
  ).toBe(false);
});
