import { expect, it } from 'vitest';
import { t } from '../catalog.js';

it('registers the performers-change bell copy in both locales', () => {
  expect(t('ar', 'inApp.service_line_performers_changed')).toBe(
    'تغيّر منفّذو خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: صافي السطر {{line_net}} دينار.',
  );
  expect(t('en', 'inApp.service_line_performers_changed')).toBe(
    'The performers of {{service_name_en}} at {{branch_name_en}} dated {{business_date}} were changed: the line net is {{line_net}} KWD.',
  );
});
