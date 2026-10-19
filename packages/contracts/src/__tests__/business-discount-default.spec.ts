import { expect, it } from 'vitest';
import {
  businessIdentityNames,
  businessSettings,
  updateBusinessIdentityNamesInput,
  updateBusinessSettingsInput,
} from '../settings/business-settings.js';
import { discountLimitInput } from '../identity/discount-limit.js';
import { buildOpenApiDocument } from '../openapi.js';

it.each([null, 0, 1234, 10000])(
  'accepts a business default %s with trimmed reason',
  (limit_bps) => {
    expect(discountLimitInput.parse({ limit_bps, reason: ' synthetic ' })).toEqual({
      limit_bps,
      reason: 'synthetic',
    });
  },
);
it('refuses invalid limits/reasons, unknown keys and the generic PATCH bypass', () => {
  for (const limit_bps of [-1, 10001, 1.5, '500'])
    expect(discountLimitInput.safeParse({ limit_bps, reason: 'Synthetic' }).success).toBe(false);
  for (const reason of ['', ' ', 'x'.repeat(501)])
    expect(discountLimitInput.safeParse({ limit_bps: null, reason }).success).toBe(false);
  expect(
    discountLimitInput.safeParse({ limit_bps: 0, reason: 'Synthetic', extra: true }).success,
  ).toBe(false);
  expect(updateBusinessSettingsInput.safeParse({ limit_bps: 500 }).success).toBe(false);
  expect(businessSettings.shape.limit_bps.parse(0)).toBe(0);
  expect(businessSettings.shape.overridden.parse(['limit_bps'])).toEqual(['limit_bps']);
});
it('trims an official name, clears with null, and refuses a blank or oversized name', () => {
  expect(updateBusinessIdentityNamesInput.parse({ official_name_ar: '  صالون  ', official_name_en: null })).toEqual({
    official_name_ar: 'صالون',
    official_name_en: null,
  });
  expect(updateBusinessIdentityNamesInput.safeParse({}).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_en: ' ' }).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_en: 'a'.repeat(256) }).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_en: '😀'.repeat(255) }).success).toBe(true);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_en: '\u0000' }).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_ar: 'Synthetic\u0000name' }).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ official_name_ar: ' \u0000 ' }).success).toBe(false);
  expect(updateBusinessIdentityNamesInput.safeParse({ theme: 'dark' }).success).toBe(false);
  expect(businessIdentityNames.parse({ official_name_ar: null, official_name_en: 'Salon' })).toEqual({
    official_name_ar: null,
    official_name_en: 'Salon',
  });
});
it('publishes settings read and audited discount command with exact 200 status and company/business target', () => {
  expect(buildOpenApiDocument()).toMatchObject({
    paths: {
      '/v1/businesses/{businessId}/settings/discount-limit': {
        post: {
          operationId: 'setBusinessDiscountDefault',
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/DiscountLimit' } },
              },
            },
          },
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/DiscountLimitInput' } },
            },
          },
          parameters: [{ name: 'x-company-id' }, { name: 'businessId' }],
        },
      },
      '/v1/businesses/{businessId}/settings': { get: { operationId: 'getBusinessSettings' } },
      '/v1/businesses/{businessId}/settings/identity': {
        patch: {
          operationId: 'updateBusinessIdentityNames',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BusinessIdentityNames' },
                },
              },
            },
          },
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateBusinessIdentityNamesInput' },
              },
            },
          },
          parameters: [{ name: 'x-company-id' }, { name: 'businessId' }],
        },
      },
    },
  });
  const input = (
    buildOpenApiDocument()['components'] as { schemas: Record<string, unknown> }
  ).schemas['UpdateBusinessIdentityNamesInput'];
  expect(input).toMatchObject({
    minProperties: 1,
    properties: {
      official_name_ar: { type: 'string', nullable: true, minLength: 1, maxLength: 255 },
      official_name_en: { type: 'string', nullable: true, minLength: 1, maxLength: 255 },
    },
  });
});
