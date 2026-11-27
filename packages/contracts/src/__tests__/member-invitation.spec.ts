import { describe, expect, it } from 'vitest';

import { inviteMemberInput, invitationRoleAssignment } from '../identity/member-invitation.js';

const COMPANY = '01920000-0000-7000-8000-0000000000c9';
const BRANCH = '01920000-0000-7000-8000-0000000000b1';

const base = {
  email: 'ahmed@example.test',
  name: 'Ahmed',
  role: 'branch_manager',
  scope: { type: 'BRANCH', id: BRANCH },
  email_confirmed: true,
};

const override = {
  permission_code: 'create:customers:branch',
  effect: 'ALLOW',
  scope_type: 'BRANCH',
  scope_id: BRANCH,
  reason: 'synthetic reason',
  expires_at: null,
};

describe('invite member contract', () => {
  it('keeps the single-role payload valid — the old request is unchanged', () => {
    const parsed = inviteMemberInput.parse(base);
    expect(parsed).toEqual(base);
    expect(parsed).not.toHaveProperty('additional_roles');
    expect(parsed).not.toHaveProperty('permission_overrides');
  });

  it('accepts extra roles with their own scopes and inline overrides', () => {
    const parsed = inviteMemberInput.parse({
      ...base,
      additional_roles: [
        { role: 'branch_manager', scope: { type: 'BRANCH', id: BRANCH } },
        { role: 'accountant', scope: { type: 'COMPANY', id: COMPANY } },
      ],
      permission_overrides: [override],
    });
    expect(parsed.additional_roles).toHaveLength(2);
    expect(parsed.permission_overrides).toHaveLength(1);
  });

  it('bounds the extra roles and the inline overrides', () => {
    const role = { role: 'accountant', scope: { type: 'COMPANY', id: COMPANY } };
    const withRoles = (count: number) => ({ ...base, additional_roles: Array(count).fill(role) });
    const withOverrides = (count: number) => ({
      ...base,
      permission_overrides: Array(count).fill(override),
    });
    expect(inviteMemberInput.safeParse(withRoles(51)).success).toBe(false);
    expect(inviteMemberInput.safeParse(withRoles(50)).success).toBe(true);
    expect(inviteMemberInput.safeParse(withOverrides(101)).success).toBe(false);
    expect(inviteMemberInput.safeParse(withOverrides(100)).success).toBe(true);
  });

  it('refuses unknown fields on the assignment, the scope and the request', () => {
    expect(
      invitationRoleAssignment.safeParse({
        role: 'accountant',
        scope: { type: 'COMPANY', id: COMPANY },
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      invitationRoleAssignment.safeParse({
        role: 'accountant',
        scope: { type: 'COMPANY', id: COMPANY, extra: true },
      }).success,
    ).toBe(false);
    expect(inviteMemberInput.safeParse({ ...base, extra: true }).success).toBe(false);
  });

  it('refuses a role outside the invitable set and a scope id that is not a UUID', () => {
    expect(
      invitationRoleAssignment.safeParse({ role: 'owner', scope: { type: 'COMPANY', id: COMPANY } })
        .success,
    ).toBe(false);
    expect(
      invitationRoleAssignment.safeParse({
        role: 'accountant',
        scope: { type: 'COMPANY', id: 'not-a-uuid' },
      }).success,
    ).toBe(false);
  });
});
