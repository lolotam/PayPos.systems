import { expect, it } from 'vitest';
import { t } from '../catalog.js';

it('registers the price-edit bell copy and the fixed role labels in both locales', () => {
  expect(t('ar', 'inApp.service_line_price_edited')).toBe(
    'عدّل {{editor_name_ar}} خدمة {{service_name_ar}} في فرع {{branch_name_ar}} بتاريخ {{business_date}}: كان الصافي {{previous_net}} دينار وأصبح {{new_net}} دينار.',
  );
  expect(t('en', 'inApp.service_line_price_edited')).toBe(
    '{{editor_name_en}} edited {{service_name_en}} at {{branch_name_en}} dated {{business_date}}: the net was {{previous_net}} KWD and is now {{new_net}} KWD.',
  );
  expect(t('ar', 'inApp.editor_role_owner')).toBe('المالك');
  expect(t('en', 'inApp.editor_role_owner')).toBe('Owner');
  expect(t('ar', 'inApp.editor_role_manager')).toBe('المدير');
  expect(t('en', 'inApp.editor_role_manager')).toBe('Manager');
});
