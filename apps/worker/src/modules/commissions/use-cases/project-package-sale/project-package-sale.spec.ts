import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LockedCommissionPeriod } from '../../domain/commission-line-types.ts';
import {
  CommissionBusinessMissingError,
  CommissionPeriodRolledOverError,
  CommissionSaleInputInvalidError,
} from '../../domain/errors.ts';
import type { CommissionSaleProjectionRow } from '../../domain/commission-sale-inputs.ts';
import type {
  CommissionSaleProjectionScope,
} from '../../ports/commission-sale-projection.port.ts';
import type {
  CommissionCorrectionScope,
  CommissionBlockNotices,
} from '@pospay/commissions-posting';
import { ProjectPackageSale } from './project-package-sale.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const BUSINESS = '01920000-0000-7000-8000-0000000000b1';
const SALE = '01970000-0000-7000-8000-000000000001';

/** نداءات نطاق التصحيح ومنفذ الجرس في آخر اختبار، عشان كل اختبار يبدأ نظيف. */
const correctionCalls: string[] = [];

beforeEach(() => {
  correctionCalls.length = 0;
});

const input = (overrides: Record<string, unknown> = {}) => ({
  companyId: COMPANY,
  eventId: '01970000-0000-7000-8000-000000000009',
  businessId: BUSINESS,
  branchId: '01920000-0000-7000-8000-0000000000c1',
  saleId: SALE,
  sellerEmployeeId: '01920000-0000-7000-8000-0000000000e1',
  businessDate: '2026-11-01',
  pricePaid: '30.000',
  refundedAmount: '0.000',
  status: 'SOLD',
  revision: 1,
  ...overrides,
});

const heldRow = (revision: number): CommissionSaleProjectionRow => ({
  businessId: BUSINESS,
  saleId: SALE,
  branchId: '01920000-0000-7000-8000-0000000000c1',
  sellerEmployeeId: '01920000-0000-7000-8000-0000000000e1',
  businessDate: '2026-11-01',
  period: '2026-11',
  pricePaid: 30000n,
  refundedAmount: 0n,
  status: 'SOLD',
  revision,
});

const locked = (period: string, status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID'): LockedCommissionPeriod => ({
  period,
  statementId: '01920000-0000-7000-8000-0000000000s1',
  status,
});

type CallLog = string[];

interface FakeOverrides {
  readonly held?: CommissionSaleProjectionRow | null;
  readonly timeZone?: string | null;
  readonly locked?: readonly LockedCommissionPeriod[];
  readonly rolledOverTo?: string;
}

/** ساعة تدفع الشهر الحالي ثم الشهر البديل بعد أول قراءتين، لمحاكاة تدبّر الشهر بين القفل والتصنيف. */
function fakeClock(rolledOverTo: string | undefined): { now: () => Date } {
  let nowReads = 0;
  return {
    now: () => {
      nowReads += 1;
      return rolledOverTo !== undefined && nowReads >= 2
        ? new Date(rolledOverTo)
        : new Date('2026-11-05T09:00:00Z');
    },
  };
}

function fakeScope(overrides: FakeOverrides = {}): {
  readonly scope: CommissionSaleProjectionScope;
  readonly calls: CallLog;
  readonly clock: { now: () => Date };
} {  const calls: CallLog = [];
  const scope: CommissionSaleProjectionScope = {
    lockSale: vi.fn(async () => {
      calls.push('lockSale');
    }),
    readSale: vi.fn(async () => {
      calls.push('readSale');
      return overrides.held ?? null;
    }),
    businessTimeZone: vi.fn(async () => {
      calls.push('businessTimeZone');
      return overrides.timeZone === undefined ? 'Asia/Kuwait' : overrides.timeZone;
    }),
    lockPeriods: vi.fn(async (input) => {
      calls.push(`lockPeriods:${input.periods.join(',')}`);
      return overrides.locked ?? [];
    }),
    upsertSale: vi.fn(async () => {
      calls.push('upsertSale');
    }),
    reopenReviewed: vi.fn(async (input) => {
      calls.push(`reopenReviewed:${input.periods.join(',')}`);
    }),
  };
  return { scope, calls, clock: fakeClock(overrides.rolledOverTo) };
}

/**
 * نطاق تصحيح مسجّل: بيرجّع قيم فاضية صالحة فالمسار المغلق بيوصل لآخره،
 * وسجل نداءاته بيقول هل التصحيح اشتغل أو لا.
 */
function fakeCorrections(calls: string[]): CommissionCorrectionScope {
  return {
    readFrozenSources: async () => {
      calls.push('readFrozenSources');
      return [];
    },
    readPostedCorrections: async () => {
      calls.push('readPostedCorrections');
      return [];
    },
    readAttachmentSnapshot: async () => {
      calls.push('readAttachmentSnapshot');
      return [];
    },
    readMonthProjection: async () => {
      calls.push('readMonthProjection');
      return {
        employeeId: '01920000-0000-7000-8000-0000000000e1',
        period: '2026-10',
        lines: [],
        sales: [],
        salaries: [],
        versions: [],
        overrides: [],
        tips: [],
        corrections: [],
      };
    },
    bumpGeneration: async () => {
      calls.push('bumpGeneration');
      return 1;
    },
    insertCorrections: async () => {
      calls.push('insertCorrections');
    },
    readOpenBlock: async () => {
      calls.push('readOpenBlock');
      return null;
    },
    insertBlock: async () => {
      calls.push('insertBlock');
      return '01980000-0000-7000-8000-0000000000f2';
    },
    updateBlockCode: async () => {
      calls.push('updateBlockCode');
    },
    resolveBlock: async () => {
      calls.push('resolveBlock');
    },
  };
}

/** منفذ جرس مسجّل؛ بيتنادى بس لما التصحيح يتوقف فعلاً. */
function fakeNotices(calls: string[]): CommissionBlockNotices {
  return {
    now: () => new Date('2026-11-05T09:00:00Z'),
    recipientGroups: async () => {
      calls.push('recipientGroups');
      return [];
    },
    append: async () => {
      calls.push('append');
    },
  };
}

describe('ProjectPackageSale order (FR-015)', () => {  it('locks the sale identity before reading and writes after the period lock', async () => {
    const { scope, calls, clock } = fakeScope({
      locked: [locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(input());

    expect(calls[0]).toBe('lockSale');
    expect(calls[1]).toBe('readSale');
    expect(calls.some((entry) => entry.startsWith('lockPeriods:'))).toBe(true);
    expect(calls.indexOf('upsertSale')).toBe(calls.length - 2);
    expect(calls.at(-1)).toBe('reopenReviewed:');
  });

  it('drops an equal or older revision before any calendar read or write', async () => {
    const { scope, calls } = fakeScope({ held: heldRow(2) });
    await new ProjectPackageSale(scope, { now: () => new Date('2026-11-05T09:00:00Z') }, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(input({ revision: 2 }));

    expect(calls).toEqual(['lockSale', 'readSale']);
    expect(scope.upsertSale).not.toHaveBeenCalled();
  });

  it('locks the held month, the new month and every candidate through the current month', async () => {
    const { scope, calls, clock } = fakeScope({
      held: heldRow(1),
      locked: [locked('2026-10', 'DRAFT'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(
      input({ revision: 2, businessDate: '2026-10-20', refundedAmount: '5.000' }),
    );

    const lockCall = calls.find((entry) => entry.startsWith('lockPeriods:'));
    expect(lockCall).toBe('lockPeriods:2026-10,2026-11');
  });

  it('posts a correction for the closed affected month instead of refusing it (55-1d)', async () => {
    const { scope, calls, clock } = fakeScope({
      locked: [locked('2026-10', 'APPROVED'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(
      input({ revision: 2, businessDate: '2026-10-20' }),
    );

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
    const work = new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(input());

    await expect(work).rejects.toThrow(CommissionPeriodRolledOverError);
    expect(scope.upsertSale).not.toHaveBeenCalled();
  });

  it('throws the business-missing error for an unknown business and writes nothing', async () => {
    const { scope, calls, clock } = fakeScope({ timeZone: null });
    const work = new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(input());

    await expect(work).rejects.toThrow(CommissionBusinessMissingError);
    expect(calls.includes('upsertSale')).toBe(false);
  });

  it('reopens only the REVIEWED affected months after the write', async () => {
    const { scope, calls, clock } = fakeScope({
      locked: [locked('2026-10', 'REVIEWED'), locked('2026-11', 'DRAFT')],
    });
    await new ProjectPackageSale(scope, clock, { newId: () => '01980000-0000-7000-8000-0000000000f1' }, fakeCorrections(correctionCalls), fakeNotices(correctionCalls)).execute(
      input({ revision: 2, businessDate: '2026-10-20' }),
    );

    expect(calls.at(-1)).toBe('reopenReviewed:2026-10');
  });

  it('refuses a payload whose envelope names another sale before any read', async () => {
    const { calls } = fakeScope();
    const { normalizePackageSaleEvent } = await import('./project-package-sale.ts');
    const work = () =>
      normalizePackageSaleEvent(
        { id: '01970000-0000-7000-8000-000000000009', aggregateType: 'package_entitlement', aggregateId: SALE, companyId: COMPANY },
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
