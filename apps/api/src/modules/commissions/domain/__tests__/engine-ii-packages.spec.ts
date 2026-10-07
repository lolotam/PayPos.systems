import { expect, it, vi } from 'vitest';
import * as kernel from '@pospay/domain';

import { computePackageSaleCommission } from '../package-sale-commission.ts';
import { computePeriod } from '../period-commission.ts';
import { fixed, line, pct, period, sale, version } from './engine-ii-fixtures.ts';

it.each([
  // (100000 − 25000) × 10% = 7500 فلس.
  [pct(1000n), 100000n, 25000n, 7500n],
  // 10000 × (100000 − 25000) ÷ 100000 = 7500 فلس.
  [fixed(10000n), 100000n, 25000n, 7500n],
  // فلس مدفوع × 50% = نصف فلس → فلس واحد.
  [pct(5000n), 1n, 0n, 1n],
  // ثابت فلس × المتبقي 1 ÷ المدفوع 2 = نصف فلس → فلس واحد.
  [fixed(1n), 2n, 1n, 1n],
  // سعر صفر: النسبة صفر × 10% = صفر.
  [pct(1000n), 0n, 0n, 0n],
  // سعر صفر: الثابت صفر دون قسمة على صفر.
  [fixed(10000n), 0n, 0n, 0n],
  // المرتجع الكامل: المتبقي صفر × 10% = صفر.
  [pct(1000n), 100000n, 100000n, 0n],
  // المرتجع الكامل: 10000 × صفر ÷ 100000 = صفر.
  [fixed(10000n), 100000n, 100000n, 0n],
] as const)('package %o paid=%s refund=%s', (calc, pricePaid, refundedAmount, expected) => {
  const spy = vi.spyOn(kernel, 'roundKwd');
  try {
    expect(
      computePackageSaleCommission(
        sale({ pricePaid, refundedAmount }),
        version({ packageSale: { enabled: true, calc } }),
      ),
    ).toEqual({ ok: true, amount: expected });
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('disabled package sale pays zero while no plan is a named error', () => {
  // البيع المعطل يدفع صفر حتى لو السعر 100000؛ غياب الإعداد ليس نتيجة صفر.
  expect(computePackageSaleCommission(sale(), version())).toEqual({ ok: true, amount: 0n });
  expect(computePackageSaleCommission(sale({ pricePaid: 0n }), null)).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
});

it('sales price for the seller by business date without advancing either accumulator', () => {
  const input = period({
    lines: [line(), line({ lineId: 'b', occurredAt: 2n })],
    sales: [
      sale(),
      sale({ saleId: 'sale-b', businessDate: '2026-10-25', refundedAmount: 25000n }),
      sale({ saleId: 'imported', sellerEmployeeId: null }),
      sale({ saleId: 'other', sellerEmployeeId: 'employee-b' }),
      sale({ saleId: 'november', businessDate: '2026-11-01' }),
    ],
    versions: [
      version({
        base: { enabled: false },
        packageSale: { enabled: true, calc: pct(1000n) },
        tiers: {
          enabled: true,
          accumulator: 'SESSIONS',
          mode: 'WHOLE',
          steps: [{ from: { kind: 'SESSIONS', value: 3n }, calc: pct(9000n) }],
        },
      }),
      version({
        effectiveFrom: '2026-10-25',
        createdAt: 2n,
        version: 2n,
        packageSale: { enabled: true, calc: fixed(20000n) },
      }),
    ],
  });
  // جلستان أقل من حد 3: صفر للخدمات؛ البيع الأول 10000 والثاني 20000 × 75% = 15000.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 0n],
      ['line:b', 0n],
      ['sale:sale-a', 10000n],
      ['sale:sale-b', 15000n],
    ]),
    total: 25000n,
  });
});

it('package paid value never raises WHOLE AMOUNT thresholds', () => {
  // الخدمة 100000 أقل من 150000؛ الباقة 100000 لا تجمع، البيع 10% = 10000 وحده.
  expect(
    computePeriod(
      period({
        lines: [line()],
        sales: [sale()],
        versions: [
          version({
            base: { enabled: false },
            packageSale: { enabled: true, calc: pct(1000n) },
            tiers: {
              enabled: true,
              accumulator: 'AMOUNT',
              mode: 'WHOLE',
              steps: [{ from: { kind: 'AMOUNT', value: 150000n }, calc: pct(1000n) }],
            },
          }),
        ],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 0n],
      ['sale:sale-a', 10000n],
    ]),
    total: 10000n,
  });
});
