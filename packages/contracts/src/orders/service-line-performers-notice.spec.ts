import { expect, it } from 'vitest';
import { serviceLinePerformersNoticeRequested } from './service-line-performers-notice.js';
import { notificationRequest } from '../notifications.js';
import { inAppNotification } from '../in-app-notifications.js';
const id = '01920000-0000-7000-8000-000000004006';
const parameters = [
  { name: 'service_name_ar', type: 'text', value: 'قص' },
  { name: 'service_name_en', type: 'text', value: 'Cut' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'business_date', type: 'text', value: '2026-10-16' },
  { name: 'line_net', type: 'text', value: '20.000' },
];
const recipient = {
  channel: 'IN_APP',
  user_id: id,
  locale: 'ar',
  template_key: 'service_line_performers_changed',
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
it('strict performers notice fits existing notification request and inbox schemas', () => {
  expect(serviceLinePerformersNoticeRequested.safeParse(notice).success).toBe(true);
  expect(notificationRequest.safeParse(notice).success).toBe(true);
  expect(inAppNotification.safeParse(stored).success).toBe(true);
});
it.each(['2.500', '125.000', '1250.000'])('canonical line net %s parses', (amount) => {
  const safe_parameters = parameters.map((parameter) =>
    parameter.name === 'line_net' ? { ...parameter, value: amount } : parameter,
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
    { ...notice, reason: 'wrong split' },
    { ...notice, revision: 1 },
    { ...notice, notification_recipients: [{ ...recipient, locale: 'en' }] },
  ])
    expect(serviceLinePerformersNoticeRequested.safeParse(candidate).success).toBe(false);
});
it('rejects an identity, a performer name or a reason parameter', () => {
  const withParameter = (
    safe_parameters: ReadonlyArray<{ name: string; type: string; value: string }>,
  ) => ({
    ...notice,
    notification_recipients: [{ ...recipient, safe_parameters }],
  });
  expect(
    serviceLinePerformersNoticeRequested.safeParse(
      withParameter([...parameters, { name: 'changer_name_ar', type: 'text', value: 'ليلى' }]),
    ).success,
  ).toBe(false);
  expect(
    serviceLinePerformersNoticeRequested.safeParse(
      withParameter(
        parameters.map((parameter, index) =>
          index === 0 ? { ...parameter, name: 'reason' } : parameter,
        ),
      ),
    ).success,
  ).toBe(false);
  expect(
    serviceLinePerformersNoticeRequested.safeParse(
      withParameter(
        parameters.map((parameter) =>
          parameter.name === 'service_name_en'
            ? { ...parameter, name: 'performer_name_en' }
            : parameter,
        ),
      ),
    ).success,
  ).toBe(false);
});
