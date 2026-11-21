import { expect, it } from 'vitest';

import type { SettingsScope, SettingsTransactions } from '../../ports/settings.port.ts';
import { SetImportedRefunds } from './set-imported-refunds.ts';

function scopeWith(overrides: Partial<SettingsScope> = {}): SettingsScope {
  return {
    discountAccess: {} as SettingsScope['discountAccess'],
    identityAccess: {} as SettingsScope['identityAccess'],
    importedRefundsAccess: {
      check: async () => null,
      recheck: async () => null,
    },
    audit: { record: async () => undefined },
    outbox: { append: async () => undefined },
    logoFiles: {} as SettingsScope['logoFiles'],
    findForUpdate: async () => null,
    save: async () => {
      throw new Error('unused');
    },
    saveIdentity: async () => {
      throw new Error('unused');
    },
    saveLogo: async () => {
      throw new Error('unused');
    },
    saveImportedRefunds: async (businessId, enabled, updatedBy) =>
      ({
        importedRefundsEnabled: enabled,
        savedFor: businessId,
        updatedBy,
      }) as never,
    ...overrides,
  };
}

function transactionsWith(scope: SettingsScope, trace: string[]): SettingsTransactions {
  return {
    run: async (companyId, userId, work) => {
      trace.push(`run:${companyId}:${userId}`);
      return work(scope);
    },
  };
}

const input = { imported_refunds_enabled: true } as const;

it('the write orders check, lock, recheck, save and audit inside one transaction', async () => {
  const trace: string[] = [];
  const scope = scopeWith({
    importedRefundsAccess: {
      check: async () => {
        trace.push('check');
        return null;
      },
      recheck: async () => {
        trace.push('recheck');
        return null;
      },
    },
    findForUpdate: async () => {
      trace.push('findForUpdate');
      return { importedRefundsEnabled: false } as never;
    },
    saveImportedRefunds: async () => {
      trace.push('saveImportedRefunds');
      return { importedRefundsEnabled: true } as never;
    },
    audit: {
      record: async (entry) => {
        trace.push(
          `audit:${entry.action}:${JSON.stringify(entry.before)}→${JSON.stringify(entry.after)}`,
        );
      },
    },
  });
  const result = await new SetImportedRefunds(transactionsWith(scope, trace)).execute(
    { companyId: 'company-1', userId: 'user-1' },
    'business-1',
    input,
  );
  expect(result).toEqual({ imported_refunds_enabled: true });
  expect(trace).toEqual([
    'run:company-1:user-1',
    'check',
    'findForUpdate',
    'recheck',
    'saveImportedRefunds',
    'audit:settings.imported_refunds_switched:{"imported_refunds_enabled":false}→{"imported_refunds_enabled":true}',
  ]);
});

it('a write that does not change the effective value saves and audits nothing', async () => {
  const trace: string[] = [];
  const scope = scopeWith({
    findForUpdate: async () => ({ importedRefundsEnabled: true }) as never,
    saveImportedRefunds: async () => {
      trace.push('save');
      throw new Error('must not save');
    },
    audit: {
      record: async () => {
        trace.push('audit');
        throw new Error('must not audit');
      },
    },
  });
  const result = await new SetImportedRefunds(transactionsWith(scope, trace)).execute(
    { companyId: 'company-1', userId: 'user-1' },
    'business-1',
    { imported_refunds_enabled: true },
  );
  expect(result).toEqual({ imported_refunds_enabled: true });
  expect(trace).toEqual(['run:company-1:user-1']);
});

it('a refusal at check or at the post-lock recheck is FORBIDDEN before any write', async () => {
  for (const refused of ['check', 'recheck'] as const) {
    const trace: string[] = [];
    const scope = scopeWith({
      importedRefundsAccess: {
        check: async () => (refused === 'check' ? 'FORBIDDEN' : null),
        recheck: async () => (refused === 'recheck' ? 'FORBIDDEN' : null),
      },
      saveImportedRefunds: async () => {
        trace.push('save');
        throw new Error('must not save');
      },
    });
    await expect(
      new SetImportedRefunds(transactionsWith(scope, trace)).execute(
        { companyId: 'company-1', userId: 'user-1' },
        'business-1',
        input,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(trace).toEqual(['run:company-1:user-1']);
  }
});

it('the audit before value is the stored value, and null means the row was absent', async () => {
  const recorded: unknown[] = [];
  const scope = scopeWith({
    findForUpdate: async () => null,
    saveImportedRefunds: async () => ({ importedRefundsEnabled: true }) as never,
    audit: {
      record: async (entry) => {
        recorded.push(entry);
      },
    },
  });
  await new SetImportedRefunds(transactionsWith(scope, [])).execute(
    { companyId: 'company-1', userId: 'user-1' },
    'business-1',
    input,
  );
  expect(recorded).toEqual([
    {
      entity: 'business_settings',
      entityId: 'business-1',
      action: 'settings.imported_refunds_switched',
      before: { imported_refunds_enabled: null },
      after: { imported_refunds_enabled: true },
    },
  ]);
});
