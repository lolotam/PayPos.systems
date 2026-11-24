import { describe, expect, it } from 'vitest';

import {
  INVITABLE_ROLES,
  INVITABLE_SCOPE_TYPE,
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
