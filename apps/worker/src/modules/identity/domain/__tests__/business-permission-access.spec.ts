import { expect, it } from 'vitest';
import {
  decideBusinessPermissionHolders,
  type BusinessPermissionGrant,
} from '../business-permission-access.ts';

const COMPANY = '01920000-0000-7000-8000-000000000a0';
const BUSINESS = '01920000-0000-7000-8000-000000000b0';
const OTHER_BUSINESS = '01920000-0000-7000-8000-000000000b1';
const BRANCH = '01920000-0000-7000-8000-000000000c0';

const grant = (
  patch: Partial<BusinessPermissionGrant> & { userId: string },
): BusinessPermissionGrant => ({
  effect: 'ALLOW',
  scopeType: 'BUSINESS',
  scopeId: BUSINESS,
  ...patch,
});

const decide = (grants: readonly BusinessPermissionGrant[], owners: readonly string[] = []) =>
  decideBusinessPermissionHolders({
    companyId: COMPANY,
    businessId: BUSINESS,
    userIds: [...new Set(grants.map((item) => item.userId))],
    owners,
    grants,
  });

it('counts a role allow at company scope as a holder', () => {
  expect(decide([grant({ userId: 'u1', scopeType: 'COMPANY', scopeId: COMPANY })])).toEqual(['u1']);
});

it('counts a role allow at the scope of this business as a holder', () => {
  expect(decide([grant({ userId: 'u1' })])).toEqual(['u1']);
});

it('ignores an allow scoped to another business', () => {
  expect(decide([grant({ userId: 'u1', scopeId: OTHER_BUSINESS })])).toEqual([]);
});

it('ignores an allow scoped to a branch', () => {
  expect(decide([grant({ userId: 'u1', scopeType: 'BRANCH', scopeId: BRANCH })])).toEqual([]);
});

it('refuses a user with an allow and a deny on the business', () => {
  expect(decide([grant({ userId: 'u1' }), grant({ userId: 'u1', effect: 'DENY' })])).toEqual([]);
});

it('keeps the owner when a deny covers the business', () => {
  expect(
    decide([grant({ userId: 'u1' }), grant({ userId: 'u1', effect: 'DENY' })], ['u1']),
  ).toEqual(['u1']);
});

it('refuses a user with only a deny', () => {
  expect(decide([grant({ userId: 'u1', effect: 'DENY' })])).toEqual([]);
});

it('refuses a user with no grant at all', () => {
  expect(decide([])).toEqual([]);
});

it('collapses duplicate grants and sorts the holders', () => {
  expect(
    decide([grant({ userId: 'u2' }), grant({ userId: 'u2' }), grant({ userId: 'u1' })]),
  ).toEqual(['u1', 'u2']);
});

it('ignores a deny that does not cover the business', () => {
  expect(
    decide([
      grant({ userId: 'u1' }),
      grant({ userId: 'u1', effect: 'DENY', scopeId: OTHER_BUSINESS }),
    ]),
  ).toEqual(['u1']);
});
