import { vi } from 'vitest';

import type { CommissionSaleProjectionRow } from '../../../domain/commission-sale-inputs.ts';
import type { LockedCommissionPeriod } from '../../../domain/commission-line-types.ts';
import type { CommissionSaleProjectionScope } from '../../../ports/commission-sale-projection.port.ts';
import type { CommissionPeriodLockInput } from '../../../ports/commission-line-projection.port.ts';
import type {
  CommissionBlockNotices,
  CommissionCorrectionScope,
} from '@pospay/commissions-posting';

export const COMPANY = '01920000-0000-7000-8000-0000000000a0';
export const BUSINESS = '01920000-0000-7000-8000-0000000000b1';
export const SALE = '01970000-0000-7000-8000-000000000001';

/** نداءات نطاق التصحيح ومنفذ الجرس في آخر اختبار. */
export const correctionCalls: string[] = [];
/** معرّفات كشوف المصادر المجمّدة التي قُرئت؛ كشوف المصدر جواها. */
export const frozenStatementIds: string[] = [];

/** يمسح سجلات آخر اختبار عشان كل اختبار يبدأ نظيف. */
export function resetSaleProjectionCalls(): void {
  correctionCalls.length = 0;
  frozenStatementIds.length = 0;
}

/** حدث بيع باقة افتراضي للاختبار. */
export const input = (overrides: Record<string, unknown> = {}) => ({
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

/** الصف المحفوظ للبيع قبل التحديث. */
export const heldRow = (revision: number): CommissionSaleProjectionRow => ({
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

/** شهر مقفول بحالته؛ معرّف الكشف بيفرق بين الشهور عشان هدف التصحيح يبان. */
export const locked = (
  period: string,
  status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID',
): LockedCommissionPeriod => ({
  period,
  statementId: `statement-${period}`,
  status,
});

export interface FakeOverrides {
  readonly held?: CommissionSaleProjectionRow | null;
  readonly timeZone?: string | null;
  readonly locked?: readonly LockedCommissionPeriod[];
  readonly rolledOverTo?: string;
  readonly now?: string;
}

/** ساعة تدفع الشهر الحالي ثم الشهر البديل بعد أول قراءتين، لمحاكاة تدبّر الشهر بين القفل والتصنيف. */
function fakeClock(rolledOverTo: string | undefined, base: string): { now: () => Date } {
  let nowReads = 0;
  return {
    now: () => {
      nowReads += 1;
      return rolledOverTo !== undefined && nowReads >= 2 ? new Date(rolledOverTo) : new Date(base);
    },
  };
}

/** نطاق بيع مسجّل: بيعقفل وبيقرا وبيقفل الشهور شهر شهر زي القفل الحقيقي. */
export function fakeScope(overrides: FakeOverrides = {}): {
  readonly scope: CommissionSaleProjectionScope;
  readonly calls: string[];
  readonly clock: { now: () => Date };
} {
  const calls: string[] = [];
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
    // القفل الحقيقي بيرجّع صف كل شهر مقفول؛ الصف الموجود في اللقطة بيتقفل بحالته، والجديد بيتفتح DRAFT.
    lockPeriods: vi.fn(async (lockInput: CommissionPeriodLockInput) => {
      calls.push(`lockPeriods:${lockInput.periods.join(',')}`);
      const known = overrides.locked ?? [];
      return lockInput.periods.map((period) => {
        const held = known.find((row) => row.period === period);
        return (
          held ?? {
            period,
            statementId: `statement-${period}`,
            status: 'DRAFT' as const,
          }
        );
      });
    }),
    upsertSale: vi.fn(async () => {
      calls.push('upsertSale');
    }),
    reopenReviewed: vi.fn(async (reviewInput) => {
      calls.push(`reopenReviewed:${reviewInput.periods.join(',')}`);
    }),
  };
  return {
    scope,
    calls,
    clock: fakeClock(overrides.rolledOverTo, overrides.now ?? '2026-11-05T09:00:00Z'),
  };
}

/**
 * نطاق تصحيح مسجّل: بيرجّع قيم فاضية صالحة فالمسار المغلق بيوصل لآخره،
 * وسجل نداءاته بيقول هل التصحيح اشتغل أو لا.
 */
export function fakeCorrections(calls: string[]): CommissionCorrectionScope {
  return {
    readFrozenSources: async (readInput) => {
      calls.push('readFrozenSources');
      frozenStatementIds.push(readInput.statementId);
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
export function fakeNotices(calls: string[]): CommissionBlockNotices {
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
