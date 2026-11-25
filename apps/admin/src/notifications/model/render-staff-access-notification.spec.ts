import type { InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

const staffAccessParameters = [
  { name: 'employee_name_ar', type: 'text', value: 'سارة' },
  { name: 'employee_name_en', type: 'text', value: 'Sara' },
  { name: 'actor_name_ar', type: 'text', value: 'هبة' },
  { name: 'actor_name_en', type: 'text', value: 'Heba' },
  { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
  { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
  { name: 'occurred_date', type: 'text', value: '2026-11-25' },
  { name: 'occurred_time', type: 'text', value: '09:30' },
];

const staffAccessBell = (
  template_key: 'staff_access_granted' | 'staff_pin_set_by_other',
  locale: 'ar' | 'en' = 'ar',
): InAppNotification =>
  ({
    id: '01920000-0000-7000-8000-0000000000c1',
    company_id: '01920000-0000-7000-8000-0000000000a0',
    business_id: null,
    branch_id: null,
    source_event_id: '01920000-0000-7000-8000-0000000000c2',
    template_key,
    template_revision: 1,
    locale,
    safe_parameters: staffAccessParameters,
    created_at: '2026-11-25T09:30:00Z',
    read_at: null,
  }) as InAppNotification;

it('renders the granted staff access bell in the viewer locale', () => {
  const item = staffAccessBell('staff_access_granted');
  expect(renderNotification(item, 'ar')).toBe(
    'منح هبة دخول موظفة لـ سارة في فرع السالمية يوم 2026-11-25 الساعة 09:30.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Heba granted staff access to Sara at Salmiya on 2026-11-25 at 09:30.',
  );
  expect(renderNotification(staffAccessBell('staff_access_granted', 'en'), 'ar')).toBe(
    'منح هبة دخول موظفة لـ سارة في فرع السالمية يوم 2026-11-25 الساعة 09:30.',
  );
});

it('renders the pin reset bell in the viewer locale', () => {
  const item = staffAccessBell('staff_pin_set_by_other');
  expect(renderNotification(item, 'ar')).toBe(
    'أعاد هبة ضبط الرقم السري لـ سارة في فرع السالمية يوم 2026-11-25 الساعة 09:30.',
  );
  expect(renderNotification(item, 'en')).toBe(
    'Heba reset the PIN for Sara at Salmiya on 2026-11-25 at 09:30.',
  );
});

it('falls back to the English names when the Arabic ones are blank', () => {
  for (const key of ['staff_access_granted', 'staff_pin_set_by_other'] as const) {
    const item = {
      ...staffAccessBell(key),
      safe_parameters: staffAccessParameters.map((parameter) =>
        parameter.name.endsWith('_ar') ? { ...parameter, value: '   ' } : parameter,
      ),
    } as InAppNotification;
    expect(renderNotification(item, 'ar')).toContain('Heba');
    expect(renderNotification(item, 'ar')).toContain('Sara');
    expect(renderNotification(item, 'ar')).toContain('Salmiya');
    expect(renderNotification(item, 'ar')).not.toContain('{{');
  }
});

it('keeps the staff access bells free of a PIN, a phone or a token', () => {
  for (const key of ['staff_access_granted', 'staff_pin_set_by_other'] as const) {
    for (const locale of ['ar', 'en'] as const) {
      const text = renderNotification(staffAccessBell(key), locale);
      const withoutDateAndTime = text.replace('2026-11-25', '').replace('09:30', '');
      expect(withoutDateAndTime).not.toMatch(/\d{4,}/);
      expect(withoutDateAndTime).not.toMatch(/\+?\d{7,}/);
      expect(withoutDateAndTime).not.toMatch(/token|bearer|otp/i);
      expect(text).toContain('2026-11-25');
      expect(text).toContain('09:30');
    }
  }
});

it('reads both staff access bells from the same catalogue copy', () => {
  expect(t('ar', 'inApp.staff_access_granted')).toBe(
    'منح {{actor_name_ar}} دخول موظفة لـ {{employee_name_ar}} في فرع {{branch_name_ar}} يوم {{occurred_date}} الساعة {{occurred_time}}.',
  );
  expect(t('en', 'inApp.staff_access_granted')).toBe(
    '{{actor_name_en}} granted staff access to {{employee_name_en}} at {{branch_name_en}} on {{occurred_date}} at {{occurred_time}}.',
  );
  expect(t('ar', 'inApp.staff_pin_set_by_other')).toBe(
    'أعاد {{actor_name_ar}} ضبط الرقم السري لـ {{employee_name_ar}} في فرع {{branch_name_ar}} يوم {{occurred_date}} الساعة {{occurred_time}}.',
  );
  expect(t('en', 'inApp.staff_pin_set_by_other')).toBe(
    '{{actor_name_en}} reset the PIN for {{employee_name_en}} at {{branch_name_en}} on {{occurred_date}} at {{occurred_time}}.',
  );
});
