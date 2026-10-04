import { expect, it } from 'vitest';
import { evaluateAccess, permissionScope, type AccessGrant } from '../access.ts';
const grant: AccessGrant = {
  permission: 'create:leave:own',
  effect: 'ALLOW',
  scopeType: 'BUSINESS',
  scopeId: 'business',
};
const target = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  actorUserId: 'actor',
  subjectUserId: 'actor',
};
it('requires verified matching actor/subject and ordinary membership scope for own', () => {
  expect(permissionScope(grant.permission)).toBe('own');
  expect(evaluateAccess([grant], grant.permission, target)).toBe(true);
  for (const subjectUserId of ['other', undefined])
    expect(
      evaluateAccess([grant], grant.permission, { ...target, subjectUserId } as typeof target),
    ).toBe(false);
  expect(evaluateAccess([grant], grant.permission, { ...target, businessId: 'foreign' })).toBe(
    false,
  );
  expect(
    evaluateAccess(
      [grant, { ...grant, effect: 'DENY', scopeType: 'BRANCH', scopeId: 'branch' }],
      grant.permission,
      target,
    ),
  ).toBe(false);
});
