import { expect, it } from 'vitest';
import {
  discountLimit,
  discountLimitInput,
  discountPercentage,
} from '../identity/discount-limit.js';
import { buildOpenApiDocument } from '../openapi.js';

it.each([null, 0, 1, 1234, 10000])('accepts %s and trims its reason', (limit_bps) => {
  expect(discountLimitInput.parse({ limit_bps, reason: ' reason ' })).toEqual({
    limit_bps,
    reason: 'reason',
  });
  expect(discountLimit.parse({ limit_bps })).toEqual({ limit_bps });
});
it.each([-1, 10001, 0.1, NaN, Infinity, '100', undefined])(
  'refuses invalid bps %s',
  (limit_bps) => {
    expect(discountLimitInput.safeParse({ limit_bps, reason: 'reason' }).success).toBe(false);
  },
);
it.each([{ reason: '' }, { reason: ' ' }, { reason: 'x'.repeat(501) }, { actor: 'client' }])(
  'requires a strict reason %j',
  (change) => {
    expect(
      discountLimitInput.safeParse({ limit_bps: null, reason: 'reason', ...change }).success,
    ).toBe(false);
  },
);
it.each([
  ['0', 0],
  ['0.01', 1],
  ['12.34', 1234],
  ['12.3', 1230],
  ['100.00', 10000],
])('parses %s exactly to %i', (value, expected) => {
  expect(discountPercentage.parse(value)).toBe(expected);
});
it.each(['', '-1', '100.01', '0.001', '1e1', '1,00', 'NaN', 'Infinity'])(
  'refuses malformed percentage %s',
  (value) => {
    expect(discountPercentage.safeParse(value).success).toBe(false);
  },
);
it('publishes the 200 set/clear operation and membership detail parameter', () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<
    string,
    { post?: { responses: unknown; requestBody: unknown } }
  >;
  const operation = paths['/v1/permissions/memberships/{membershipId}/discount-limit']?.post;
  expect(operation?.responses).toHaveProperty('200');
  expect(operation?.requestBody).toMatchObject({ required: true });
  const schemas = (document.components as { schemas: Record<string, { properties?: unknown }> })
    .schemas;
  expect(schemas['MembershipPermissions']?.properties).toHaveProperty('discount_limit');
});
