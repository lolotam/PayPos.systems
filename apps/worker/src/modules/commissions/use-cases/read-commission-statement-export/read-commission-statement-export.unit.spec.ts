import { expect, it } from 'vitest';

import type {
  CommissionStatementExportReaderData,
  CommissionStatementFrozenRow,
} from '../../ports/commission-statement-export.port.ts';
import {
  CommissionStatementPaymentDataUnavailable,
  ReadCommissionStatementExport,
} from './read-commission-statement-export.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const RENDER = '01920000-0000-7000-8000-0000000000e1';

function row(employeeId: string, partial: boolean): CommissionStatementFrozenRow {
  return {
    employeeId,
    employeeNumber: 1,
    employeeNameAr: null,
    employeeNameEn: 'Sara',
    sourceRef: `employee:${employeeId}`,
    kind: 'EMPLOYEE',
    amount: 0n,
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: null,
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    attachedBranchIds: [],
    partial,
    businessDate: null,
    serviceNameAr: null,
    serviceNameEn: null,
    customerName: null,
  };
}

function paidData(
  overrides: Partial<CommissionStatementExportReaderData> & {
    readonly paidMethod: 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH' | null;
  },
): CommissionStatementExportReaderData {
  const { paidMethod, ...rest } = overrides;
  return {
    request: {
      statementId: 's1',
      businessId: 'b1',
      period: '2026-10',
      statementStatus: 'PAID',
      paidMethod,
      language: 'en',
      scope: 'BRANCHES',
      branchIds: ['branch-1'],
      employeeIds: ['e-full', 'e-partial'],
    },
    rows: [row('e-full', false), row('e-partial', true)],
    paidCash: [],
    ...rest,
  };
}

function useCase(data: CommissionStatementExportReaderData) {
  return new ReadCommissionStatementExport({ read: async () => data });
}

it('a PAID statement with no recorded method is unavailable', async () => {
  await expect(useCase(paidData({ paidMethod: null })).execute(COMPANY, RENDER)).rejects.toThrow(
    CommissionStatementPaymentDataUnavailable,
  );
});

it('a CASH statement missing the payment row of a full-month employee is unavailable', async () => {
  await expect(useCase(paidData({ paidMethod: 'CASH' })).execute(COMPANY, RENDER)).rejects.toThrow(
    CommissionStatementPaymentDataUnavailable,
  );
});

it('a CASH statement whose cash column was never read is unavailable', async () => {
  await expect(
    useCase(paidData({ paidMethod: 'CASH', paidCash: null })).execute(COMPANY, RENDER),
  ).rejects.toThrow(CommissionStatementPaymentDataUnavailable);
});

it('a CASH statement keeps only the full-month paid amount and strips partial employees', async () => {
  const result = await useCase(
    paidData({
      paidMethod: 'CASH',
      paidCash: [
        { employeeId: 'e-full', amount: 41_005n },
        { employeeId: 'e-partial', amount: 12_000n },
      ],
    }),
  ).execute(COMPANY, RENDER);
  expect(result.paidCash).toEqual([{ employeeId: 'e-full', amount: 41_005n }]);
});

it('a CASH statement returns empty paidCash when every visible employee is partial', async () => {
  const base = paidData({
    paidMethod: 'CASH',
    paidCash: [{ employeeId: 'e-partial', amount: 12_000n }],
  });
  const result = await useCase({
    ...base,
    rows: base.rows.filter((row) => row.partial),
  }).execute(COMPANY, RENDER);
  expect(result.paidCash).toEqual([]);
});

it('a non-cash PAID statement needs no payment rows', async () => {
  const result = await useCase(paidData({ paidMethod: 'BANK_TRANSFER', paidCash: null })).execute(
    COMPANY,
    RENDER,
  );
  expect(result.paidCash).toBeNull();
});
