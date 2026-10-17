import { expect, it } from 'vitest';
import { t } from '../catalog.js';

it('registers the cancel bell copy in both locales', () => {
  expect(t('ar', 'inApp.service_line_cancelled')).toBe(
    'أُلغيت خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان صافي السطر {{cancelled_net}} دينار.',
  );
  expect(t('en', 'inApp.service_line_cancelled')).toBe(
    '{{service_name_en}} was cancelled at {{branch_name_en}} dated {{business_date}}: the line net was {{cancelled_net}} KWD.',
  );
});
