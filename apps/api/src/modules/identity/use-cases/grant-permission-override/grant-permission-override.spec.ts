import { describe, expect, it, vi } from 'vitest';
import type { PermissionOverrideInput } from '@pospay/contracts';

import type {
  PermissionOverrideScope,
  PermissionOverrideTransactions,
} from '../../ports/permission-overrides.port.ts';
import { GrantPermissionOverride } from './grant-permission-override.ts';

// اختبار ترتيب الخطوات فقط؛ سياسة الإنتاج تظل مقفولة وتختبرها اختبارات domain وHTTP الحقيقية.
vi.mock('../../domain/permission-edit.ts', () => ({
  permissionEditFailure: () => null,
  permissionEditingEnabled: () => false,
}));

const companyId = '01920000-0000-7000-8000-0000000000a0';
const userId = '01920000-0000-7000-8000-0000000000a1';
const membershipId = '01920000-0000-7000-8000-0000000000a2';
const overrideId = '01920000-0000-7000-8000-0000000000a3';
const now = new Date('2026-10-02T10:00:00Z');
const terms: PermissionOverrideInput = {
  permission_code: 'read:memberships:company',
  effect: 'DENY',
  scope_type: 'COMPANY',
  scope_id: companyId,
  reason: 'synthetic change',
  expires_at: null,
};
const saved = { ...terms, id: overrideId, granted_by: userId, granted_at: now.toISOString() };

function setup(failure?: 'audit' | 'duplicate') {
  const events: string[] = [];
  const audit = vi.fn(async () => {
    events.push('audit');
    if (failure === 'audit') throw new Error('audit failed');
  });
  const scope: PermissionOverrideScope = {
    context: async () => ({
      companyId,
      now,
      membership: null,
      target: null,
      catalog: [],
      grants: [],
    }),
    insert: async () => {
      events.push('insert');
      return failure === 'duplicate' ? null : saved;
    },
    audit: { record: audit },
  };
  const transactions: PermissionOverrideTransactions = {
    run: async (company, actor, work) => {
      expect([company, actor]).toEqual([companyId, userId]);
      events.push('begin');
      const result = await work(scope);
      events.push('commit');
      return result;
    },
  };
  const invalidate = vi.fn(async (company: string) => {
    expect(company).toBe(companyId);
    events.push('invalidate');
  });
  const useCase = new GrantPermissionOverride(transactions, { invalidate }, { now: () => now });
  return { useCase, events, audit, invalidate };
}

describe('permission override write ordering', () => {
  it('records the exact actor, decision and membership before commit, then invalidates grants', async () => {
    const { useCase, events, audit } = setup();
    expect(await useCase.execute({ companyId, userId }, membershipId, terms)).toEqual(saved);
    expect(events).toEqual(['begin', 'insert', 'audit', 'commit', 'invalidate']);
    expect(audit).toHaveBeenCalledWith({
      entity: 'permission_override',
      entityId: overrideId,
      action: 'permission.granted',
      before: null,
      after: { ...saved, membership_id: membershipId },
    });
  });
  it('does not commit or invalidate when the audit fails', async () => {
    const { useCase, events, invalidate } = setup('audit');
    await expect(useCase.execute({ companyId, userId }, membershipId, terms)).rejects.toThrow(
      'audit failed',
    );
    expect(events).toEqual(['begin', 'insert', 'audit']);
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('does not audit or invalidate a conflicting active override', async () => {
    const { useCase, events, audit, invalidate } = setup('duplicate');
    await expect(useCase.execute({ companyId, userId }, membershipId, terms)).rejects.toMatchObject(
      { code: 'PERMISSION_OVERRIDE_EXISTS' },
    );
    expect(events).toEqual(['begin', 'insert']);
    expect(audit).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
