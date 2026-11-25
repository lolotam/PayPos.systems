import { describe, expect, it } from 'vitest';

import { createTemplateRegistry, readNotificationConfiguration } from '../configuration.ts';
import { ratingRequest } from '../templates/rating-request.ts';
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

const id = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const firstName = { name: 'customer_first_name', type: 'text' as const, value: 'Mona' };
const business = { name: 'business_name', type: 'text' as const, value: 'Salon Rose' };
const performers = { name: 'performers', type: 'text' as const, value: 'Sara' };
const requestId = { name: 'rating_request_id', type: 'text' as const, value: id };
const full = [firstName, business, performers, requestId];
const withoutFirstName = full.slice(1);

describe('rating_request template (59b-3, dormant)', () => {
  it('declares the approved ordered descriptors and ar/en copy', () => {
    expect(ratingRequest).toMatchObject({
      key: 'rating_request',
      revision: 1,
      category: 'UTILITY',
      locales: ['ar', 'en'],
    });
    expect(ratingRequest.parameters.map((p) => [p.name, p.required])).toEqual([
      ['customer_first_name', false],
      ['business_name', true],
      ['performers', true],
      ['rating_request_id', true],
    ]);
    for (const locale of ['ar', 'en'] as const) {
      expect(ratingRequest.copy[locale]).toContain('{{link}}');
      expect(ratingRequest.copy[locale]).toContain('{{performers}}');
    }
  });

  it.each(['ar', 'en'])('%s accepts four parameters and three without the first name', (locale) => {
    expect(validateParameters(ratingRequest, locale, full)).toBe(true);
    expect(validateParameters(ratingRequest, locale, withoutFirstName)).toBe(true);
    expect(
      templateComponents(ratingRequest, withoutFirstName).flatMap((c) =>
        c.parameters.map((p) => p.text),
      ),
    ).toEqual(['Salon Rose', 'Sara', id]);
  });

  it('rejects a bad id, a link, a missing required, a duplicate, an extra or reordered parameter', () => {
    const swap = (index: number, value: string) =>
      full.map((p, i) => (i === index ? { ...p, value } : p));
    expect(validateParameters(ratingRequest, 'ar', swap(3, id.toUpperCase()))).toBe(false);
    expect(validateParameters(ratingRequest, 'ar', swap(3, 'https://x.test/#abc'))).toBe(false);
    expect(validateParameters(ratingRequest, 'ar', swap(2, 'https://x.test'))).toBe(false);
    expect(validateParameters(ratingRequest, 'ar', [firstName, business, requestId])).toBe(false);
    expect(validateParameters(ratingRequest, 'ar', [firstName, ...full])).toBe(false);
    expect(
      validateParameters(ratingRequest, 'ar', [business, firstName, performers, requestId]),
    ).toBe(false);
    expect(validateParameters(ratingRequest, 'ar', [...full, requestId])).toBe(false);
    expect(validateParameters(ratingRequest, 'fr', full)).toBe(false);
    expect(() => templateComponents(ratingRequest, [business])).toThrow(
      'NOTIFICATION_PARAMETERS_INVALID',
    );
  });

  it('stays disabled by default and is enabled only by an explicit approved name', () => {
    expect(createTemplateRegistry().prepare('rating_request', 1, 'ar', full)).toEqual({
      valid: false,
      code: 'CONFIG_INVALID',
    });
    const enabled = createTemplateRegistry(undefined, {
      rating_request: { ar: 'rating_request_ar' },
    });
    expect(enabled.prepare('rating_request', 1, 'ar', withoutFirstName)).toMatchObject({
      valid: true,
      name: 'rating_request_ar',
    });
  });
});
