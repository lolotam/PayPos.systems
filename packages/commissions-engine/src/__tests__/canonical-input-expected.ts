import { at, octoberRows, type StatementMonthRows } from './statement-fixtures.ts';

const NOOR = 'employee-noor';
const SARA = 'employee-sara';

/**
 * إصدارات الخطة: سارة 1 و9 و10 (العاشر إصلاح لأكتوبر)، ونور إصدار بأساسي وشرائح بخطوتين وبيع باقة.
 *
 * @param base صفوف أكتوبر الأساسية
 * @returns الإصدارات كلها
 */
function versionsOf(base: StatementMonthRows): StatementMonthRows['versions'] {
  const first = at(base.versions, 0);
  return [
    ...base.versions,
    {
      ...first,
      version: 9n,
      effectiveFrom: '2026-10-10',
      wholePeriod: true,
      createdAt: 1_789_000_000_000_003n,
      base: { enabled: true, calc: { kind: 'PCT', value: 200n } },
      packageSale: { enabled: false },
    },
    {
      ...first,
      version: 10n,
      repairPeriod: '2026-10',
      createdAt: 1_789_000_000_000_004n,
      packageSale: { enabled: false },
    },
    {
      employeeId: NOOR,
      effectiveFrom: '2026-09-15',
      wholePeriod: false,
      repairPeriod: null,
      createdAt: 1_789_100_000_000_000n,
      version: 1n,
      base: { enabled: true, calc: { kind: 'PCT', value: 300n } },
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          { from: { kind: 'AMOUNT', value: 100_000n }, calc: { kind: 'PCT', value: 500n } },
          { from: { kind: 'AMOUNT', value: 200_000n }, calc: { kind: 'FIXED', value: 3_000n } },
        ],
      },
      packageSale: { enabled: true, calc: { kind: 'FIXED', value: 2_000n } },
    },
  ];
}

/**
 * التصحيحات المستلمة: تصحيح البند الأساسي وتصحيحان لنفس مصدر البيع بجيل 9 و10.
 *
 * @param base صفوف أكتوبر الأساسية
 * @returns التصحيحات كلها
 */
function correctionsOf(base: StatementMonthRows): StatementMonthRows['corrections'] {
  const sale = { ...at(base.corrections, 0), sourceRef: 'sale:old-sale', kind: 'SALE' as const };
  return [
    ...base.corrections,
    {
      ...sale,
      id: 'correction-9',
      generation: 9n,
      amount: -2_000n,
      previousAmount: 5_000n,
      newAmount: 3_000n,
    },
    {
      ...sale,
      id: 'correction-10',
      generation: 10n,
      amount: 500n,
      previousAmount: 3_000n,
      newAmount: 3_500n,
    },
  ];
}

/**
 * أكتوبر كامل لبصمة المدخلات: فيكستشر الكشف زائد عناصر تانية عشان كل قايمة يبقى فيها عنصرين على الأقل
 * لنفس الموظفة، وإصدارات بأرقام 1 و9 و10 وتصحيحين لنفس المصدر بجيل 9 و10 (الترتيب النصي هيحط 10 قبل 9).
 *
 * @returns صفوف الشهر
 */
export function fullRows(): StatementMonthRows {
  const base = octoberRows();
  return {
    ...base,
    lines: base.lines.map((line) =>
      line.lineId === 'line-2' ? { ...line, ruleSnapshot: { kind: 'FOLLOW_PLAN' as const } } : line,
    ),
    sales: [
      ...base.sales,
      {
        ...at(base.sales, 0),
        saleId: 'sale-2',
        revision: 2n,
        businessDate: '2026-10-12',
        pricePaid: 20_000n,
        refundedAmount: 0n,
      },
    ],
    tips: [
      ...base.tips,
      { ...at(base.tips, 0), sessionId: 'session-2', businessDate: '2026-10-15', amount: 1_500n },
    ],
    salaries: [
      ...base.salaries,
      { employeeId: SARA, effectiveFrom: '2026-09-01', amount: 300_000n, revision: 1n },
    ],
    versions: versionsOf(base),
    overrides: [
      ...base.overrides,
      {
        ...at(base.overrides, 0),
        id: 'override-2',
        serviceId: 'service-9',
        effectiveFrom: '2026-10-03',
        createdAt: 1_789_000_000_000_005n,
        rule: { kind: 'FIXED', value: 1_000n },
      },
      {
        ...at(base.overrides, 0),
        id: 'override-3',
        serviceId: 'service-7',
        effectiveFrom: '2026-10-04',
        createdAt: 1_789_000_000_000_006n,
        rule: { kind: 'ZERO' },
      },
    ],
    corrections: correctionsOf(base),
    blocked: [...base.blocked, { employeeId: NOOR, sourcePeriod: '2026-07', code: 'NO_SALARY' }],
    carries: [
      ...base.carries,
      {
        ...at(base.carries, 0),
        sourceStatementId: 'statement-aug',
        sourcePeriod: '2026-08',
        amount: -1_000n,
      },
    ],
  };
}

const rule = (kind: string, value?: string) => (value === undefined ? { kind } : { kind, value });
const none = { enabled: false };

/** مدخل نور: بند بقاعدة 10%، وإصدار بأساسي وشرائح بخطوتين وبيع باقة، وموقوفين مفتوحين. */
const NOOR_ENTRY = {
  employee_id: NOOR,
  lines: [
    {
      line_id: 'line-3',
      revision: '1',
      occurred_at: '2026-09-25T01:33:20.000000Z',
      recorded_at: '2026-09-25T01:33:20.000001Z',
      business_date: '2026-10-08',
      service_id: 'service-1',
      net_share: '20.000',
      share_bps: '10000',
      counts: true,
      rule_snapshot: rule('PCT', '1000'),
    },
  ],
  sales: [],
  tips: [],
  salary: null,
  versions: [
    {
      version: '1',
      effective_from: '2026-09-15',
      whole_period: false,
      repair_period: null,
      created_at: '2026-09-11T04:13:20.000000Z',
      base: { enabled: true, calc: rule('PCT', '300') },
      tiers: {
        enabled: true,
        mode: 'MARGINAL',
        accumulator: 'AMOUNT',
        steps: [
          { from: rule('AMOUNT', '100.000'), calc: rule('PCT', '500') },
          { from: rule('AMOUNT', '200.000'), calc: rule('FIXED', '3.000') },
        ],
      },
      package_sale: { enabled: true, calc: rule('FIXED', '2.000') },
    },
  ],
  overrides: [],
  corrections: [],
  blocked_corrections: [
    { source_period: '2026-07', code: 'NO_SALARY' },
    { source_period: '2026-08', code: 'NO_PLAN' },
  ],
  carries: [],
};

const SARA_LINES = [
  {
    line_id: 'line-1',
    revision: '2',
    occurred_at: '2026-09-21T14:13:20.000001Z',
    recorded_at: '2026-09-21T14:13:20.000002Z',
    business_date: '2026-10-05',
    service_id: 'service-1',
    net_share: '100.000',
    share_bps: '10000',
    counts: true,
    rule_snapshot: rule('PCT', '500'),
  },
  {
    line_id: 'line-2',
    revision: '1',
    occurred_at: '2026-10-02T00:13:20.000000Z',
    recorded_at: '2026-10-02T00:13:20.000001Z',
    business_date: '2026-10-20',
    service_id: 'service-2',
    net_share: '50.000',
    share_bps: '10000',
    counts: true,
    rule_snapshot: rule('FOLLOW_PLAN'),
  },
];

const SARA_VERSIONS = [
  {
    version: '1',
    effective_from: '2026-10-01',
    whole_period: false,
    repair_period: null,
    created_at: '2026-09-10T00:26:40.000001Z',
    base: none,
    tiers: none,
    package_sale: { enabled: true, calc: rule('PCT', '1000') },
  },
  {
    version: '9',
    effective_from: '2026-10-10',
    whole_period: true,
    repair_period: null,
    created_at: '2026-09-10T00:26:40.000003Z',
    base: { enabled: true, calc: rule('PCT', '200') },
    tiers: none,
    package_sale: none,
  },
  {
    version: '10',
    effective_from: '2026-10-01',
    whole_period: false,
    repair_period: '2026-10',
    created_at: '2026-09-10T00:26:40.000004Z',
    base: none,
    tiers: none,
    package_sale: none,
  },
];

const correction = (patch: Record<string, string>) => ({
  source_period: '2026-09',
  source_ref: 'line:old-1',
  kind: 'COMMISSION',
  amount: '3.000',
  previous_amount: '0.000',
  new_amount: '3.000',
  generation: '1',
  ...patch,
});

/** مدخل سارة: كل قايمة بعنصرين على الأقل، مكتوبة بإيدي من القواعد (مش منسوخة من ناتج الدالة). */
const SARA_ENTRY = {
  employee_id: SARA,
  lines: SARA_LINES,
  sales: [
    {
      sale_id: 'sale-1',
      revision: '1',
      business_date: '2026-10-10',
      price_paid: '50.000',
      refunded_amount: '10.000',
    },
    {
      sale_id: 'sale-2',
      revision: '2',
      business_date: '2026-10-12',
      price_paid: '20.000',
      refunded_amount: '0.000',
    },
  ],
  tips: [
    {
      session_id: 'session-1',
      revision: '1',
      method: 'CARD',
      business_date: '2026-10-05',
      amount: '6.000',
    },
    {
      session_id: 'session-1',
      revision: '1',
      method: 'CASH',
      business_date: '2026-10-05',
      amount: '2.000',
    },
    {
      session_id: 'session-2',
      revision: '1',
      method: 'CARD',
      business_date: '2026-10-15',
      amount: '1.500',
    },
  ],
  salary: { effective_from: '2026-10-01', revision: '3' },
  versions: SARA_VERSIONS,
  overrides: [
    {
      id: 'override-1',
      service_id: 'service-1',
      effective_from: '2026-10-01',
      created_at: '2026-09-10T00:26:40.000002Z',
      rule: rule('PCT', '1500'),
    },
    {
      id: 'override-2',
      service_id: 'service-9',
      effective_from: '2026-10-03',
      created_at: '2026-09-10T00:26:40.000005Z',
      rule: rule('FIXED', '1.000'),
    },
    {
      id: 'override-3',
      service_id: 'service-7',
      effective_from: '2026-10-04',
      created_at: '2026-09-10T00:26:40.000006Z',
      rule: rule('ZERO'),
    },
  ],
  corrections: [
    correction({}),
    correction({
      source_ref: 'sale:old-sale',
      kind: 'SALE',
      amount: '-2.000',
      previous_amount: '5.000',
      new_amount: '3.000',
      generation: '9',
    }),
    correction({
      source_ref: 'sale:old-sale',
      kind: 'SALE',
      amount: '0.500',
      previous_amount: '3.000',
      new_amount: '3.500',
      generation: '10',
    }),
  ],
  blocked_corrections: [],
  carries: [
    { source_statement_id: 'statement-aug', kind: 'COMMISSION', amount: '-1.000' },
    { source_statement_id: 'statement-sep', kind: 'COMMISSION', amount: '-5.000' },
    { source_statement_id: 'statement-sep', kind: 'TIP_CARD', amount: '-2.000' },
  ],
};

/** القيمة القياسية المتوقعة لـ `fullRows()`، مكتوبة بإيدي: نور قبل سارة (ترتيب المعرّف). */
export const EXPECTED_CANONICAL_INPUT = { period: '2026-10', employees: [NOOR_ENTRY, SARA_ENTRY] };
