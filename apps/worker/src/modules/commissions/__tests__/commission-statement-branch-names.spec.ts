import type { Tx } from '@pospay/db';
import { expect, it } from 'vitest';

import type {
  CommissionBranchName,
  CommissionBranchNamesReader,
  CommissionStatementFrozenRow,
} from '../index.ts';
import {
  readBranchNames,
  withBranchNames,
} from '../persistence/commission-statement-export.transactions.ts';

const fakeTx = {} as unknown as Tx;

function row(overrides: Partial<CommissionStatementFrozenRow> = {}): CommissionStatementFrozenRow {
  return {
    employeeId: 'employee-1',
    employeeNumber: 7,
    employeeNameAr: 'سارة',
    employeeNameEn: 'Sara',
    sourceRef: 'line:early',
    kind: 'COMMISSION',
    amount: 10_000n,
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: 'branch-1',
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    attachedBranchIds: ['branch-1'],
    partial: false,
    businessDate: '2026-10-10',
    serviceNameAr: null,
    serviceNameEn: null,
    customerName: null,
    ...overrides,
  };
}

it('asks the port once for the distinct branch ids of the exported rows', async () => {
  const calls: { companyId: string; businessId: string; branchIds: readonly string[] }[] = [];
  const port: CommissionBranchNamesReader = {
    names: async (_tx, companyId, businessId, branchIds) => {
      calls.push({ companyId, businessId, branchIds: [...branchIds] });
      return new Map<string, CommissionBranchName>();
    },
  };
  const names = await readBranchNames(port, fakeTx, 'company-1', 'business-1', [
    row({ sourceBranchId: 'branch-1' }),
    row({ sourceBranchId: 'branch-2' }),
    row({ sourceBranchId: 'branch-1' }),
    row({ sourceBranchId: null }),
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.companyId).toBe('company-1');
  expect(calls[0]?.businessId).toBe('business-1');
  expect(calls[0]?.branchIds).toEqual(['branch-1', 'branch-2']);
  expect(names.size).toBe(0);
});

it('fills the branch names and keeps every row even when its branch was not read', () => {
  const names = new Map<string, CommissionBranchName>([
    ['branch-1', { nameAr: 'حولي', nameEn: 'Hawally' }],
  ]);
  const filled = withBranchNames(
    [
      row({ sourceBranchId: 'branch-1' }),
      row({ sourceBranchId: 'branch-2' }),
      row({ sourceBranchId: null }),
    ],
    names,
  );
  expect(filled).toHaveLength(3);
  expect(filled[0]?.sourceBranchNameAr).toBe('حولي');
  expect(filled[0]?.sourceBranchNameEn).toBe('Hawally');
  expect(filled[1]?.sourceBranchNameAr).toBeNull();
  expect(filled[1]?.sourceBranchNameEn).toBeNull();
  expect(filled[2]?.sourceBranchNameAr).toBeNull();
  expect(filled[2]?.sourceBranchNameEn).toBeNull();
});
