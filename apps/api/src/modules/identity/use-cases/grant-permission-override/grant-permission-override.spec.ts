import { describe, expect, it, vi } from 'vitest';
import type {
  PermissionOverrideScope,
  PermissionOverrideTransactions,
} from '../../ports/permission-overrides.port.ts';
import { GrantPermissionOverride } from './grant-permission-override.ts';
import { RevokePermissionOverride } from '../revoke-permission-override/revoke-permission-override.ts';
import type { PermissionEditContext } from '../../domain/permission-edit.ts';
const now = new Date('2026-10-03T10:00:00Z');
const actor = { companyId: 'company', userId: 'editor' };
const membershipId = 'member';
const terms = {
  permission_code: 'read:memberships:company',
  effect: 'ALLOW' as const,
  scope_type: 'COMPANY' as const,
  scope_id: actor.companyId,
  reason: 'synthetic',
  expires_at: null,
};
const saved = { ...terms, id: 'override', granted_by: actor.userId, granted_at: now.toISOString() };

const context: PermissionEditContext = {
  companyId: actor.companyId,
  editorUserId: actor.userId,
  editorIsCompanyOwner: false,
  now,
  holderMemberships: [],
  membership: {
    id: membershipId,
    userId: null,
    employeeId: 'employee',
    roleCode: 'viewer',
    systemRoleCode: null,
    allowedPermissions: null,
    isCompanyOwner: false,
    scopeType: 'COMPANY',
    scopeId: actor.companyId,
    startsAt: new Date('2020-01-01'),
    endsAt: null,
  },
  target: { companyId: actor.companyId },
  descendantTargets: [],
  catalog: [terms.permission_code],
  grants: [terms.permission_code, 'manage:memberships:company'].map((permission) => ({
    permission,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: actor.companyId,
  })),
};

function setup(existing = false, auditFailure = false, editContext = context) {
  const events: string[] = [];
  const record = vi.fn(async () => {
    events.push('audit');
    if (auditFailure) throw new Error('audit failed');
  });
  const scope: PermissionOverrideScope = {
    context: async () => editContext,
    current: async () => (existing ? [saved] : []),
    find: async () => saved,
    insert: async () => {
      events.push('insert');
      return saved;
    },
    end: async () => {
      events.push('end');
      return { ...saved, expires_at: now.toISOString() };
    },
    audit: { record },
  };
  const transactions: PermissionOverrideTransactions = {
    run: async (companyId, userId, work) => {
      expect({ companyId, userId }).toEqual(actor);
      events.push('begin');
      const result = await work(scope);
      events.push('commit');
      return result;
    },
  };
  const invalidate = vi.fn(async () => {
    events.push('invalidate');
  });
  return {
    events,
    record,
    invalidate,
    grant: new GrantPermissionOverride(transactions, { invalidate }),
    revoke: new RevokePermissionOverride(transactions, { invalidate }),
  };
}

it.each(['DENY', 'REPLACE', 'REVOKE'] as const)(
  'protects an owner holder through a Viewer membership on %s before any writes',
  async (operation) => {
    const membership = context.membership;
    if (membership === null) throw new Error('Synthetic membership missing');
    const s = setup(operation !== 'DENY', false, {
      ...context,
      holderMemberships: [
        { ...membership, id: 'owner-sibling', roleCode: 'owner', isCompanyOwner: true },
      ],
    });
    const work =
      operation === 'REVOKE'
        ? s.revoke.execute(actor, membershipId, saved.id, { reason: 'synthetic' })
        : s.grant.execute(actor, membershipId, {
            ...terms,
            effect: operation === 'DENY' ? 'DENY' : 'ALLOW',
          });
    await expect(work).rejects.toMatchObject({ code: 'PERMISSION_OWNER_PROTECTED' });
    expect(s.events).toEqual(['begin']);
    expect(s.record).not.toHaveBeenCalled();
    expect(s.invalidate).not.toHaveBeenCalled();
  },
);

describe('permission write ordering', () => {
  it('creates with audit before commit and invalidates the changed membership after it', async () => {
    const s = setup();
    expect(await s.grant.execute(actor, membershipId, terms)).toEqual(saved);
    expect(s.events).toEqual(['begin', 'insert', 'audit', 'commit', 'invalidate']);
    expect(s.invalidate).toHaveBeenCalledWith(actor.companyId, membershipId);
    expect(s.record).toHaveBeenCalledWith({
      entity: 'permission_override',
      entityId: saved.id,
      action: 'permission.granted',
      before: null,
      after: { ...saved, membership_id: membershipId },
    });
  });
  it('ends the previous decision before inserting a replacement, retaining before/after', async () => {
    const s = setup(true);
    await s.grant.execute(actor, membershipId, { ...terms, effect: 'DENY' });
    expect(s.events).toEqual(['begin', 'end', 'insert', 'audit', 'commit', 'invalidate']);
    expect(s.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permission.replaced',
        before: [{ ...saved, membership_id: membershipId }],
      }),
    );
  });
  it('revokes with the mandatory reason in the audit and retains the original reason on the row', async () => {
    const s = setup(true);
    const ended = await s.revoke.execute(actor, membershipId, saved.id, { reason: 'end now' });
    expect(ended.reason).toBe('synthetic');
    expect(s.events).toEqual(['begin', 'end', 'audit', 'commit', 'invalidate']);
    expect(s.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permission.revoked',
        after: { ...ended, membership_id: membershipId, reason: 'end now' },
      }),
    );
  });
  it.each(['grant', 'revoke'] as const)(
    'never commits or invalidates if %s audit fails',
    async (operation) => {
      const s = setup(true, true);
      const work =
        operation === 'grant'
          ? s.grant.execute(actor, membershipId, terms)
          : s.revoke.execute(actor, membershipId, saved.id, { reason: 'end now' });
      await expect(work).rejects.toThrow('audit failed');
      expect(s.events).not.toContain('commit');
      expect(s.invalidate).not.toHaveBeenCalled();
    },
  );
});
