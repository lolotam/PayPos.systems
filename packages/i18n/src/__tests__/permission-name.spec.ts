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
      'correct:attendance:branch',
    ])
      expect(permissionName(locale, code)).not.toBe(code);
    expect(permissionName(locale, 'read:future:business')).toBe('read:future:business');
  },
);
