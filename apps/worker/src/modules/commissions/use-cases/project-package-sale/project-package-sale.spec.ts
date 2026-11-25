import { beforeEach, describe, expect, it } from 'vitest';

import {
  CommissionBusinessMissingError,
  CommissionPeriodRolledOverError,
  CommissionSaleInputInvalidError,
} from '../../domain/errors.ts';
import {
  BUSINESS,
  COMPANY,
  correctionCalls,
  fakeCorrections,
  fakeNotices,
  fakeScope,
  frozenStatementIds,
  heldRow,
  input,
  locked,
  resetSaleProjectionCalls,
  SALE,
} from './__tests__/project-package-sale.fixture.ts';
import { ProjectPackageSale } from './project-package-sale.ts';

const IDS = { newId: () => '01980000-0000-7000-8000-0000000000f1' };

beforeEach(() => {
  resetSaleProjectionCalls();
});

describe('ProjectPackageSale order (FR-015)', () => {
  it('locks the sale identity before reading and writes after the period lock', async () => {
    const { scope, calls, clock } = fakeScope({ locked: [locked('2026-11', 'DRAFT')] });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input());

    expect(calls[0]).toBe('lockSale');
    expect(calls[1]).toBe('readSale');
    expect(calls.some((entry) => entry.startsWith('lockPeriods:'))).toBe(true);
    expect(calls.indexOf('upsertSale')).toBe(calls.length - 2);
    expect(calls.at(-1)).toBe('reopenReviewed:');
  });

  it('drops an equal or older revision before any calendar read or write', async () => {
    const { scope, calls } = fakeScope({ held: heldRow(2) });
    await new ProjectPackageSale(
      scope,
      { now: () => new Date('2026-11-05T09:00:00Z') },
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ revision: 2 }));

    expect(calls).toEqual(['lockSale', 'readSale']);
    expect(scope.upsertSale).not.toHaveBeenCalled();
  });
});

describe('ProjectPackageSale period lock (FR-015)', () => {
  it('locks the held month and the new month in ascending order, one month per lock', async () => {
    const { scope, calls, clock } = fakeScope({
      held: heldRow(1),
      locked: [locked('2026-10', 'DRAFT'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ revision: 2, businessDate: '2026-10-20', refundedAmount: '5.000' }));

    expect(calls.filter((entry) => entry.startsWith('lockPeriods:'))).toEqual([
      'lockPeriods:2026-10',
      'lockPeriods:2026-11',
    ]);
  });

  it('posts a correction for the closed affected month instead of refusing it (55-1d)', async () => {
    const { scope, calls, clock } = fakeScope({
      locked: [locked('2026-10', 'APPROVED'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ revision: 2, businessDate: '2026-10-20' }));

    expect(calls.includes('upsertSale')).toBe(true);
    expect(correctionCalls).toContain('bumpGeneration');
    expect(correctionCalls).toContain('readMonthProjection');
    expect(correctionCalls).toContain('insertCorrections');
  });
});

describe('ProjectPackageSale refusals (FR-015)', () => {
  it('throws the rollover error when the current month moves between plan and lock', async () => {
    const { scope, clock } = fakeScope({
      locked: [locked('2026-11', 'DRAFT')],
      rolledOverTo: '2026-12',
    });
    const work = new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input());

    await expect(work).rejects.toThrow(CommissionPeriodRolledOverError);
    expect(scope.upsertSale).not.toHaveBeenCalled();
  });

  it('throws the business-missing error for an unknown business and writes nothing', async () => {
    const { scope, calls, clock } = fakeScope({ timeZone: null });
    const work = new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input());

    await expect(work).rejects.toThrow(CommissionBusinessMissingError);
    expect(calls.includes('upsertSale')).toBe(false);
  });
});

describe('ProjectPackageSale review and identity (FR-015)', () => {
  it('reopens only the REVIEWED affected months after the write', async () => {
    const { scope, calls, clock } = fakeScope({
      locked: [locked('2026-10', 'REVIEWED'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ revision: 2, businessDate: '2026-10-20' }));

    expect(calls.at(-1)).toBe('reopenReviewed:2026-10');
  });

  it('refuses a payload whose envelope names another sale before any read', async () => {
    const { calls } = fakeScope();
    const { normalizePackageSaleEvent } = await import('./project-package-sale.ts');
    const work = () =>
      normalizePackageSaleEvent(
        {
          id: '01970000-0000-7000-8000-000000000009',
          aggregateType: 'package_entitlement',
          aggregateId: SALE,
          companyId: COMPANY,
        },
        {
          sale_id: '01970000-0000-7000-8000-000000000002',
          business_id: BUSINESS,
          branch_id: '01920000-0000-7000-8000-0000000000c1',
          sold_at: '2026-10-31T21:30:00Z',
          business_date: '2026-11-01',
          seller_employee_id: '01920000-0000-7000-8000-0000000000e1',
          price_paid: '30.000',
          refunded_amount: '0.000',
          status: 'SOLD',
          revision: 1,
          schema_version: 1,
        },
      );
    expect(work).toThrow(CommissionSaleInputInvalidError);
    expect(calls).toEqual([]);
  });
});

describe('ProjectPackageSale historical replay (50-4)', () => {
  it('locks one open historical month only and never walks towards the current month', async () => {
    const { scope, calls, clock } = fakeScope({ now: '2026-12-05T09:00:00Z' });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ businessDate: '0001-01-15' }));

    expect(calls.filter((entry) => entry.startsWith('lockPeriods:'))).toEqual([
      'lockPeriods:0001-01',
    ]);
  });

  it('walks a closed historical month to its first open target and stops there', async () => {
    const { scope, calls, clock } = fakeScope({
      now: '2026-12-05T09:00:00Z',
      locked: [
        locked('2024-01', 'APPROVED'),
        locked('2024-02', 'REVIEWED'),
        locked('2024-03', 'DRAFT'),
      ],
    });
    await new ProjectPackageSale(
      scope,
      clock,
      IDS,
      fakeCorrections(correctionCalls),
      fakeNotices(correctionCalls),
    ).execute(input({ businessDate: '2024-01-15' }));

    // القفل بيقف عند أول شهر مفتوح بعد الشهر المقفول، فمفيش قفل للشهور اللي بينه وبين الشهر الحالي.
    expect(calls.filter((entry) => entry.startsWith('lockPeriods:'))).toEqual([
      'lockPeriods:2024-01',
      'lockPeriods:2024-02',
      'lockPeriods:2024-03',
    ]);
    // التصحيح اشتغل على الشهر المقفول 2024-01، والهدف هو أول شهر مفتوح بعده وهو 2024-03.
    expect(frozenStatementIds).toContain('statement-2024-01');
    expect(correctionCalls).toContain('insertCorrections');
  });
});
