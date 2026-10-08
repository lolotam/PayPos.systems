import type { InAppNotification } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { renderNotification } from './render-notification';

const shift = (locale: 'ar' | 'en', arabic = 'ليلى', english = 'Laila'): InAppNotification => ({
  id: '01920000-0000-7000-8000-0000000000c1',
  company_id: '01920000-0000-7000-8000-0000000000a0',
  business_id: null,
  branch_id: null,
  source_event_id: '01920000-0000-7000-8000-0000000000c2',
  template_key: 'shift_not_clocked_in',
  template_revision: 1,
  locale,
  safe_parameters: [
    { name: 'employee_name_ar', type: 'text', value: arabic },
    { name: 'employee_name_en', type: 'text', value: english },
    { name: 'branch_name_ar', type: 'text', value: 'السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya' },
    { name: 'shift_start', type: 'text', value: '10:00' },
  ],
  created_at: '2026-10-01T12:00:00Z',
  read_at: null,
});

function sentence(locale: 'ar' | 'en', employee: string, branch: string) {
  const employeeKey = locale === 'ar' ? 'employee_name_ar' : 'employee_name_en';
  const branchKey = locale === 'ar' ? 'branch_name_ar' : 'branch_name_en';
  return t(locale, 'inApp.shift_not_clocked_in')
    .replace(`{{${employeeKey}}}`, employee)
    .replace('{{shift_start}}', '10:00')
    .replace(`{{${branchKey}}}`, branch);
}

it('renders shift_not_clocked_in in the viewer locale when the stored locale differs', () => {
  expect(renderNotification(shift('ar'), 'en')).toBe(sentence('en', 'Laila', 'Salmiya'));
  expect(renderNotification(shift('en'), 'ar')).toBe(sentence('ar', 'ليلى', 'السالمية'));
});

it('falls back to the English name when the Arabic parameter is blank', () => {
  const blank = shift('en', '   ', 'Studio 2026');
  const branch = {
    ...blank,
    safe_parameters: blank.safe_parameters.map((parameter) =>
      parameter.name === 'branch_name_ar' ? { ...parameter, value: '   ' } : parameter,
    ),
  } as InAppNotification;
  expect(renderNotification(branch, 'ar')).toBe(sentence('ar', 'Studio 2026', 'Salmiya'));
});

it('keeps generic_notice on the stored locale', () => {
  const item: InAppNotification = {
    ...shift('ar'),
    template_key: 'generic_notice',
    safe_parameters: [{ name: 'subject', type: 'text', value: 'Synthetic subject' }],
  };
  const arabic = t('ar', 'inApp.generic_notice').replace('{{subject}}', 'Synthetic subject');
  expect(renderNotification(item, 'en')).toBe(arabic);
  expect(renderNotification(item, 'ar')).toBe(arabic);
});
