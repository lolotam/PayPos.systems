import { expect, it } from 'vitest';
import { permissionName } from '../permission-name.js';

it.each(['ar', 'en'] as const)(
  'labels every scoped permission and the later catalog additions in %s',
  (locale) => {
    for (const code of [
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
      'read:package-types:business',
      'manage:package-types:business',
      'correct:attendance:branch',
      'edit:service-line-prices:branch',
      'change:service-line-performers:branch',
      'cancel:service-lines:branch',
    ])
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
    expect(permissionName(locale, 'read:future:business')).toBe('read:future:business');
  },
);
