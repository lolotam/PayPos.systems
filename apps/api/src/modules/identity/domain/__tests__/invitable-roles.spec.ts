import { describe, expect, it } from 'vitest';

import {
  INVITABLE_ROLES,
  INVITABLE_SCOPE_TYPE,
  collectInvitationAssignments,
  invitationScopeFailure,
  invitableScopeType,
  isInvitableRole,
} from '../invitable-roles.ts';

// قائمة الدعوة بيانات (IM-Q2، BR-5): الاختبارات دي بثبّت العقد الحالي — الأدوار الأربعة
// ونطاق كل دور، وإن دور المالك مش في القائمة أبداً بالبناء.
describe('invitable roles', () => {
  it('the table is exactly the four roles of IM-Q2 with the scope each role needs', () => {
    expect(INVITABLE_ROLES).toEqual([
      'general_manager',
      'business_manager',
      'branch_manager',
      'accountant',
    ]);
    expect(INVITABLE_SCOPE_TYPE).toEqual({
      general_manager: 'COMPANY',
      business_manager: 'BUSINESS',
      branch_manager: 'BRANCH',
      accountant: 'COMPANY',
    });
  });

  it('the owner role is absent by construction, and every entry has a scope', () => {
    expect(INVITABLE_ROLES as readonly string[]).not.toContain('owner');
    for (const role of INVITABLE_ROLES) {
      expect(INVITABLE_SCOPE_TYPE[role]).toBeDefined();
    }
  });
});

describe('the closed role list and its scope table', () => {
  it.each([
    ['general_manager', true],
    ['business_manager', true],
    ['branch_manager', true],
    ['accountant', true],
    ['owner', false],
    ['staff', false],
    ['cashier', false],
    ['cashier_reception', false],
    ['', false],
    ['GENERAL_MANAGER', false],
  ])('isInvitableRole(%j) is %j', (role, expected) => {
    expect(isInvitableRole(role)).toBe(expected);
  });

  it.each([
    ['general_manager', 'COMPANY'],
    ['business_manager', 'BUSINESS'],
    ['branch_manager', 'BRANCH'],
    ['accountant', 'COMPANY'],
    ['owner', null],
    ['anything', null],
  ])('invitableScopeType(%j) is %j', (role, expected) => {
    expect(invitableScopeType(role)).toBe(expected);
  });

  it.each([
    ['general_manager', 'COMPANY', null],
    ['business_manager', 'BUSINESS', null],
    ['branch_manager', 'BRANCH', null],
    ['accountant', 'COMPANY', null],
    // دور المالك وقائمة الأدوار المغلوقة بترفض مهما كان النطاق.
    ['owner', 'COMPANY', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['accountant', 'BUSINESS', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['accountant', 'BRANCH', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['branch_manager', 'COMPANY', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['branch_manager', 'BUSINESS', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['general_manager', 'BRANCH', 'MEMBER_ROLE_NOT_INVITABLE'],
    ['general_manager', 'BUSINESS', 'MEMBER_ROLE_NOT_INVITABLE'],
  ])('invitationScopeFailure(%j, %j) is %j', (role, scopeType, expected) => {
    expect(invitationScopeFailure(role, scopeType)).toBe(expected);
  });
});

// «أدوار أكتر» (080): التوزيعات بتتجمع وبيتشيّل المكرر، وكل واحد بيتحقق على جدول الأدوار.
describe('collecting the invitation assignments', () => {
  const branch = { type: 'BRANCH', id: 'branch-1' } as const;

  it('keeps the primary assignment alone when there are no extra roles', () => {
    expect(
      collectInvitationAssignments({ role: 'branch_manager', scope: branch }),
    ).toEqual({
      ok: true,
      assignments: [{ role: 'branch_manager', scope: { type: 'BRANCH', id: 'branch-1' } }],
    });
  });

  it('puts the primary first and keeps the extra roles after it', () => {
    const collected = collectInvitationAssignments({
      role: 'branch_manager',
      scope: branch,
      additional_roles: [
        { role: 'branch_manager', scope: { type: 'BRANCH', id: 'branch-2' } },
        { role: 'accountant', scope: { type: 'COMPANY', id: 'company-1' } },
      ],
    });
    expect(collected.ok).toBe(true);
    expect(collected.ok ? collected.assignments : []).toHaveLength(3);
    expect(collected.ok ? collected.assignments[0]?.scope.id : '').toBe('branch-1');
  });

  it('drops an extra role that repeats the primary assignment', () => {
    const collected = collectInvitationAssignments({
      role: 'branch_manager',
      scope: branch,
      additional_roles: [{ role: 'branch_manager', scope: { type: 'BRANCH', id: 'branch-1' } }],
    });
    expect(collected.ok ? collected.assignments : []).toHaveLength(1);
  });

  it('refuses an extra role whose scope does not match the role', () => {
    expect(
      collectInvitationAssignments({
        role: 'branch_manager',
        scope: branch,
        additional_roles: [{ role: 'accountant', scope: { type: 'BRANCH', id: 'branch-2' } }],
      }),
    ).toEqual({ ok: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' });
  });
});
