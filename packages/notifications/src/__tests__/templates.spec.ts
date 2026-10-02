import { describe, expect, it } from 'vitest';

import { createTemplateRegistry, readNotificationConfiguration } from '../configuration.ts';
import { staffOtp } from '../templates/staff-otp.ts';
import {
  templateComponents,
  validateParameters,
  type TemplateDefinition,
} from '../templates/definition.ts';

describe('immutable bilingual definitions', () => {
  it('staff_otp is authentication with a sensitive ordered code and ar/en preview only', () => {
    expect(staffOtp).toMatchObject({
      key: 'staff_otp',
      revision: 1,
      category: 'AUTHENTICATION',
      locales: ['ar', 'en'],
    });
    expect(staffOtp.parameters).toEqual([
      { name: 'code', type: 'text', required: true, sensitivity: 'sensitive', component: 'body' },
    ]);
    expect(staffOtp.copy.ar).toContain('{{code}}');
    expect(staffOtp.copy.en).toContain('{{code}}');
    expect(
      validateParameters(staffOtp, 'ar', [{ name: 'code', type: 'text', value: '000000' }]),
    ).toBe(false);
  });
  const definition: TemplateDefinition = {
    key: 'test_notice',
    revision: 1,
    category: 'UTILITY',
    locales: ['ar', 'en'],
    copy: { ar: 'اختبار', en: 'Test' },
    parameters: [
      { name: 'name', component: 'header', type: 'text', required: true, sensitivity: 'safe' },
      { name: 'count', component: 'body', type: 'number', required: true, sensitivity: 'safe' },
    ],
  };
  const ordered = [
    { name: 'name', type: 'text' as const, value: 'Test' },
    { name: 'count', type: 'number' as const, value: 2 },
  ];
  it.each(['ar', 'en'])('%s requires exact ordered count/types and declared language', (locale) => {
    expect(validateParameters(definition, locale, ordered)).toBe(true);
    expect(validateParameters(definition, locale, [...ordered].reverse())).toBe(false);
    expect(validateParameters(definition, locale, ordered.slice(0, 1))).toBe(false);
    expect(templateComponents(definition, ordered).map((v) => v.type)).toEqual(['header', 'body']);
  });
  it('unapproved names/revisions and sensitive links/phones fail closed', () => {
    expect(
      createTemplateRegistry([definition]).prepare('test_notice', 1, 'ar', ordered).valid,
    ).toBe(false);
    const registry = createTemplateRegistry([definition], {
      test_notice: { ar: 'test_notice_ar' },
    });
    expect(registry.prepare('test_notice', 2, 'ar', ordered).valid).toBe(false);
    expect(validateParameters(definition, 'fr', ordered)).toBe(false);
    for (const value of ['https://example.test/bearer', '+96500000001', 'test-token', '000000']) {
      expect(
        validateParameters(definition, 'ar', [
          { name: 'name', type: 'text', value },
          { name: 'count', type: 'number', value: 2 },
        ]),
      ).toBe(false);
    }
  });
});

describe('additional safety checks', () => {
  it('production fake and incomplete live configurations refuse startup', () => {
    expect(() =>
      readNotificationConfiguration({ NODE_ENV: 'production', NOTIFICATIONS_MODE: 'fake' }),
    ).toThrow('NOTIFICATIONS_FAKE_IN_PRODUCTION');
    expect(() => readNotificationConfiguration({ NOTIFICATIONS_MODE: 'live' })).toThrow(
      'NOTIFICATION_HASH_CONFIG_INVALID',
    );
  });
});
