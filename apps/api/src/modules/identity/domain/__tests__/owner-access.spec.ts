import { expect, it } from 'vitest';
import { protectOwnerAccess } from '../owner-access.ts';
import { evaluateAccess, type AccessGrant } from '../access.ts';

const companyId = 'company';
const allow: AccessGrant = {
  permission: 'read:settings:business',
  scopeType: 'COMPANY',
  scopeId: companyId,
  effect: 'ALLOW',
};
const deny: AccessGrant = { ...allow, effect: 'DENY' };
it('keeps ordinary DENY authoritative and removes only the administrative owner restriction', () => {
  const grants = [allow, deny];
  expect(evaluateAccess(protectOwnerAccess(grants, false), allow.permission, { companyId })).toBe(
    false,
  );
  expect(evaluateAccess(protectOwnerAccess(grants, true), allow.permission, { companyId })).toBe(
    true,
  );
  expect(grants).toEqual([allow, deny]);
});
it('preserves ADR-0019 staff login refusal and never fabricates an ALLOW', () => {
  const login = { ...deny, permission: 'login:staff:branch' };
  expect(protectOwnerAccess([login], true)).toEqual([login]);
  expect(protectOwnerAccess([deny], true)).toEqual([]);
});
