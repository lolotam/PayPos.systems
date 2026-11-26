import { expect, it } from 'vitest';
import { t } from '../catalog.js';

it('registers the refund bell copy in both locales', () => {
  expect(t('ar', 'inApp.package_refund_recorded')).toBe(
    'استُردت {{sessions}} جلسة من باقة {{package_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: المبلغ {{amount}} دينار.',
  );
  expect(t('en', 'inApp.package_refund_recorded')).toBe(
    '{{sessions}} session(s) refunded from {{package_name_en}} at {{branch_name_en}} dated {{business_date}}: amount {{amount}} KWD.',
  );
});

it('registers the generic package name in both locales', () => {
  expect(t('ar', 'inApp.generic_package')).toBe('باقة');
  expect(t('en', 'inApp.generic_package')).toBe('Package');
});
