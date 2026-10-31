import { expect, it } from 'vitest';
import { permissionName } from '../permission-name.js';

const LABELLED_CODES = [
  'read:salaries:business',
  'manage:salaries:business',
  'read:schedules:branch',
  'manage:schedules:branch',
  'read:schedules:business',
  'manage:schedules:business',
  'manage:schedule-settings:business',
  'read:memberships:business',
  'manage:memberships:business',
  'manage:employees:business',
  'manage:files:business',
  'read:files:business',
  'manage:document-types:company',
  'manage:discounts:company',
  'create:customers:company',
  'create:customers:business',
  'create:customers:branch',
  'manage:discount-limits:business',
  'read:settings:business',
  'manage:settings:business',
  'manage:business-identity:business',
  'manage:alert-rules:business',
  'manage:rating-requests:business',
  'manage:commission-plans:business',
  'manage:employee-number:company',
  'read:package-types:business',
  'manage:package-types:business',
  'read:service-categories:business',
  'manage:service-categories:business',
  'read:service-categories:branch',
  'manage:service-categories:branch',
  'correct:attendance:branch',
  'edit:service-line-prices:branch',
  'change:service-line-performers:branch',
  'cancel:service-lines:branch',
  'approve:discounts:branch',

];

it.each(['ar', 'en'] as const)(
  'labels every scoped permission and the later catalog additions in %s',
  (locale) => {
    for (const code of LABELLED_CODES)
      expect(permissionName(locale, code)).not.toBe(code);
    expect(permissionName('ar', 'edit:service-line-prices:branch')).toBe('تعديل سعر/خصم جلسة');
    expect(permissionName('en', 'edit:service-line-prices:branch')).toBe('Edit session price/discount');
    expect(permissionName('ar', 'change:service-line-performers:branch')).toBe(
      'تغيير منفّذي بند الخدمة',
    );
    expect(permissionName('en', 'change:service-line-performers:branch')).toBe(
      'Change service line performers',
    );
    expect(permissionName('ar', 'cancel:service-lines:branch')).toBe('إلغاء بنود الخدمة');
    expect(permissionName('en', 'cancel:service-lines:branch')).toBe('Cancel service lines');
    expect(permissionName('ar', 'approve:discounts:branch')).toBe('الموافقة على خصم فوق الحد');
    expect(permissionName('en', 'approve:discounts:branch')).toBe('Approve discounts above the limit');
    expect(permissionName('ar', 'manage:business-identity:business')).toBe('إدارة هوية النشاط');
    expect(permissionName('en', 'manage:business-identity:business')).toBe(
      'Manage business identity',
    );
    expect(permissionName('ar', 'manage:alert-rules:business')).toBe('إدارة التنبيهات');
    expect(permissionName('en', 'manage:alert-rules:business')).toBe('Manage alerts');
    expect(permissionName('ar', 'manage:rating-requests:business')).toBe('إدارة رسايل التقييم');
    expect(permissionName('en', 'manage:rating-requests:business')).toBe('Manage rating messages');
    expect(permissionName('ar', 'manage:commission-plans:business')).toBe('إدارة خطط العمولة');
    expect(permissionName('en', 'manage:commission-plans:business')).toBe('Manage commission plans');
    expect(permissionName('ar', 'manage:employee-number:company')).toBe('إدارة الرقم الوظيفي');
    expect(permissionName('en', 'manage:employee-number:company')).toBe('Manage employee numbers');
    expect(permissionName(locale, 'read:future:business')).toBe('read:future:business');
  },
);

it('MY-Q5 manage:staff-app-columns:business has an Arabic and an English name', () => {
  expect(permissionName('ar', 'manage:staff-app-columns:business')).toBe('أعمدة تطبيق الموظفين');
  expect(permissionName('en', 'manage:staff-app-columns:business')).toBe(
    'Manage staff app columns',
  );
  for (const locale of ['ar', 'en'] as const)
    expect(permissionName(locale, 'manage:staff-app-columns:business')).not.toBe(
      'manage:staff-app-columns:business',
    );
});
