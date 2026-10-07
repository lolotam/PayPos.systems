import { describe, expect, it } from 'vitest';

import type { ServiceCommissionOverride, ServiceCommissionRule } from '../commission-types.ts';
import { computePeriod } from '../period-commission.ts';
import { validateCommissionPlan } from '../plan-validation.ts';
import type {
  CommissionPackageSale,
  CommissionPlanVersion,
  PeriodCommissionLine,
} from '../plan-types.ts';
import { fixed, line, pct, period, sale, version } from './engine-ii-fixtures.ts';

// اقتراحات للمالك، مش خطط الصالون. كل وصف بيعرض قدرة واحدة المحرك بيدعمها ولسه متختراش.
// الأرقام محسوبة باليد.

const sessions = (count: number, netShare: bigint): PeriodCommissionLine[] =>
  Array.from({ length: count }, (_, index) =>
    line({ lineId: String(index + 1), occurredAt: BigInt(index + 1), netShare }),
  );

const expectSources = (
  plan: CommissionPlanVersion,
  input: {
    readonly lines?: readonly PeriodCommissionLine[];
    readonly sales?: readonly CommissionPackageSale[];
    readonly overrides?: readonly ServiceCommissionOverride[];
  },
  entries: readonly (readonly [string, bigint])[],
  total: bigint,
) => {
  expect(
    computePeriod(
      period({
        lines: input.lines ?? [],
        sales: input.sales ?? [],
        overrides: input.overrides ?? [],
        versions: [plan],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map(entries), total });
};

const accepts = (plan: CommissionPlanVersion) => {
  expect(validateCommissionPlan(plan)).toEqual({ ok: true });
};

const override = (serviceId: string, rule: ServiceCommissionRule): ServiceCommissionOverride => ({
  id: `override-${serviceId}`,
  employeeId: 'employee-a',
  serviceId,
  effectiveFrom: '2026-10-01',
  createdAt: 1n,
  rule,
});

describe('S1 fixed amount per session', () => {
  // مبلغ ثابت على الحصة، من غير شرائح: الجلسة الكاملة تاخد المبلغ كله.
  const plan = version({ base: { enabled: true, calc: fixed(2000n) }, tiers: { enabled: false } });

  it('pays 2.000 on each of three full sessions', () => {
    // 2.000 × حصة كاملة × 3 = 6.000. قيمة الجلسة مش داخلة في الثابت.
    const lines = sessions(3, 10000n);
    expectSources(
      plan,
      { lines },
      lines.map((row): [string, bigint] => [`line:${row.lineId}`, 2000n]),
      6000n,
    );
  });

  it('pays half the fixed amount on a 50/50 share', () => {
    // shareBps 5000: 2.000 × 50% = 1.000.
    expectSources(
      plan,
      { lines: [line({ shareBps: 5000n, netShare: 50000n })] },
      [['line:a', 1000n]],
      1000n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});

describe('S2 bonus per session after a session count', () => {
  // البونص ثابت على الجلسة اللي عدد اللي قبلها وصل 40، مش على قيمة الجلسة.
  const plan = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'SESSIONS',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'SESSIONS', value: 40n }, calc: fixed(3000n) }],
    },
  });

  it('pays 3.000 only on the 41st and 42nd sessions', () => {
    // الجلسة بتتسعر بالعدد اللي قبلها: 1–40 عندها x من 0 لـ 39 فصفر،
    // والـ 41 والـ 42 عندهم x = 40 و 41 فيدفعوا 3.000. المجموع 6.000.
    const lines = sessions(42, 10000n);
    expectSources(
      plan,
      { lines },
      lines.map((row, index): [string, bigint] => [
        `line:${row.lineId}`,
        index < 40 ? 0n : 3000n,
      ]),
      6000n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});

describe('S3 two marginal amount tiers', () => {
  // شريحتان هامشيتان: 5% من 1,000 وبعدين 10% من 2,000. الأساس مقفول.
  const plan = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [
        { from: { kind: 'AMOUNT', value: 1000000n }, calc: pct(500n) },
        { from: { kind: 'AMOUNT', value: 2000000n }, calc: pct(1000n) },
      ],
    },
  });

  it('splits 1,500 then 1,000 across 5% and 10%', () => {
    // 0→1,500: 500 × 5% = 25.000. 1,500→2,500: 500 × 5% + 500 × 10% = 75.000. المجموع 100.000.
    const lines = [
      line({ netShare: 1500000n }),
      line({ lineId: 'b', occurredAt: 2n, netShare: 1000000n }),
    ];
    expectSources(
      plan,
      { lines },
      [
        ['line:a', 25000n],
        ['line:b', 75000n],
      ],
      100000n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});

describe('S4 base plus a marginal tier', () => {
  // 2% على كل بند، و 5% زيادة على الجزء اللي يعدّي 1,000. الأساس بيتجمع مش بيستبدل.
  const plan = version({
    base: { enabled: true, calc: pct(200n) },
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'AMOUNT', value: 1000000n }, calc: pct(500n) }],
    },
  });

  it('adds 2% on both lines and 5% only on the part above 1,000', () => {
    // البند الأول 800 × 2% = 16.000. التاني 700 × 2% = 14.000 زائد (1,500 − 1,000) × 5% = 25.000.
    // 14.000 + 25.000 = 39.000. المجموع 55.000.
    const lines = [
      line({ netShare: 800000n }),
      line({ lineId: 'b', occurredAt: 2n, netShare: 700000n }),
    ];
    expectSources(
      plan,
      { lines },
      [
        ['line:a', 16000n],
        ['line:b', 39000n],
      ],
      55000n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});

describe('S5 package-sale commission', () => {
  const paid = sale({ pricePaid: 300000n, refundedAmount: 100000n });

  it('pays 3% of the price still paid', () => {
    // (300.000 − 100.000) × 3% = 6.000. البيع مش داخل مجمّع الجلسات.
    const plan = version({
      base: { enabled: false },
      packageSale: { enabled: true, calc: pct(300n) },
    });
    accepts(plan);
    expectSources(plan, { sales: [paid] }, [['sale:sale-a', 6000n]], 6000n);
  });

  it('scales a fixed sale amount by the share of the price still paid', () => {
    // 5.000 × 200/300 = 3.3333… والباقي تلت مش نص، فالتقريب لأقرب فلس = 3.333.
    const plan = version({
      base: { enabled: false },
      packageSale: { enabled: true, calc: fixed(5000n) },
    });
    accepts(plan);
    expectSources(plan, { sales: [paid] }, [['sale:sale-a', 3333n]], 3333n);
  });
});

describe('S6 per-service exception', () => {
  // التجاوز بيستبدل الخطة للخدمة دي بس؛ الخدمة من غير تجاوز تفضل على 1%.
  const plan = version({ base: { enabled: true, calc: pct(100n) }, tiers: { enabled: false } });

  it('pays the override instead of 1%, including a zero exception', () => {
    // الثابت 10.000 على حصة كاملة بدل 1.500. ZERO بيدفع صفر بدل 1%. والثالثة 150.000 × 1% = 1.500.
    const lines = [
      line({ serviceId: 'service-fixed', netShare: 150000n }),
      line({ lineId: 'b', occurredAt: 2n, serviceId: 'service-zero', netShare: 150000n }),
      line({ lineId: 'c', occurredAt: 3n, serviceId: 'service-plan', netShare: 150000n }),
    ];
    expectSources(
      plan,
      {
        lines,
        overrides: [
          override('service-fixed', fixed(10000n)),
          override('service-zero', { kind: 'ZERO' }),
        ],
      },
      [
        ['line:a', 10000n],
        ['line:b', 0n],
        ['line:c', 1500n],
      ],
      11500n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});

describe('S7 whole session tiers', () => {
  // WHOLE بيعيد تسعير كل الجلسات بالخطوة اللي وصلها العدد النهائي، مش بالعدد وقت الجلسة.
  const plan = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'SESSIONS',
      mode: 'WHOLE',
      steps: [
        { from: { kind: 'SESSIONS', value: 0n }, calc: fixed(1000n) },
        { from: { kind: 'SESSIONS', value: 30n }, calc: fixed(1500n) },
      ],
    },
  });

  it('pays 1.000 each when the month ends on 29 sessions', () => {
    // X = 29 أقل من 30، فالخطوة من 0: 1.000 × 29 = 29.000.
    const lines = sessions(29, 10000n);
    expectSources(
      plan,
      { lines },
      lines.map((row): [string, bigint] => [`line:${row.lineId}`, 1000n]),
      29000n,
    );
  });

  it('reprices every session at 1.500 once the month reaches 30', () => {
    // X = 30 بيوصل للخطوة التانية، فكل الجلسات بما فيها الأولى تبقى 1.500. المجموع 45.000.
    const lines = sessions(30, 10000n);
    expectSources(
      plan,
      { lines },
      lines.map((row): [string, bigint] => [`line:${row.lineId}`, 1500n]),
      45000n,
    );
  });

  it('passes the §5.7 validator', () => {
    accepts(plan);
  });
});
