import { expect, it } from 'vitest';
import { t } from '../catalog.js';

it('registers the discount approval bell copy in both locales', () => {
  expect(t('ar', 'inApp.discount_approval_requested')).toBe(
    'طلب موافقة على خصم في فرع {{branch_name_ar}}: {{service_name_ar}}، عدد السطور {{line_count}}، الخصم حتى {{max_percent}}%.',
  );
  expect(t('en', 'inApp.discount_approval_requested')).toBe(
    'Discount approval requested at {{branch_name_en}}: {{service_name_en}}, {{line_count}} line(s), discount up to {{max_percent}}%.',
  );
});
