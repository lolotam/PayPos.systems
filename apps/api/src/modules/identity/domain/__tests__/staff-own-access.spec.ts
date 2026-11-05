import { expect, it } from 'vitest';
import { evaluateAccess, type AccessGrant } from '../access.ts';
import { protectOwnerAccess } from '../owner-access.ts';

const codes = [
  'read:service-sessions:own',
  'read:commissions:own',
  'read:attendance:own',
  'read:ratings:own',
];
const target = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  actorUserId: 'actor',
  subjectUserId: 'actor',
};
const allow = (permission: string): AccessGrant => ({
  permission,
  effect: 'ALLOW',
  scopeType: 'BUSINESS',
  scopeId: 'business',
});

it.each(codes)('MY-12 %s refuses missing or foreign ownership even for an owner', (code) => {
  const grants = protectOwnerAccess([allow(code)], true);
  expect(evaluateAccess(grants, code, target)).toBe(true);
  const scope = {
    companyId: target.companyId,
    businessId: target.businessId,
    branchId: target.branchId,
  };
  for (const unverified of [
    { ...scope, subjectUserId: 'actor' },
    { ...scope, actorUserId: 'actor' },
    { ...target, subjectUserId: 'colleague' },
  ])
    expect(evaluateAccess(grants, code, unverified)).toBe(false);
  expect(evaluateAccess(grants, code, { ...target, businessId: 'foreign' })).toBe(false);
  expect(
    evaluateAccess(
      [{ ...allow(code), scopeType: 'COMPANY', scopeId: 'other-company' }],
      code,
      target,
    ),
  ).toBe(false);
  expect(
    evaluateAccess(
      [{ ...allow(code), scopeType: 'BRANCH', scopeId: 'other-branch' }],
      code,
      target,
    ),
  ).toBe(false);
});

it.each(codes)('MY-11 %s covering DENY wins except for a canonical owner', (code) => {
  const grants: AccessGrant[] = [
    allow(code),
    { ...allow(code), effect: 'DENY', scopeType: 'BRANCH', scopeId: 'branch' },
  ];
  expect(evaluateAccess(protectOwnerAccess(grants, false), code, target)).toBe(false);
  expect(evaluateAccess(protectOwnerAccess(grants, true), code, target)).toBe(true);
  expect(evaluateAccess(grants, code, { ...target, branchId: 'sibling' })).toBe(true);
  expect(evaluateAccess([], code, target)).toBe(false);
});
