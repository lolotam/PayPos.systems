import { buildCanonicalInput } from '../canonical-input.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';
import { fullRows } from './canonical-input-expected.ts';
import { PERIOD, type StatementMonthRows } from './statement-fixtures.ts';

type Mutation = () => string;

/**
 * يعدّل عنصر واحد في قايمة من `fullRows()` بتعديل واحد، ويرجّع نص المدخل القياسي بعده.
 *
 * @param key القايمة
 * @param index موضع العنصر في `fullRows()`
 * @param change الحقل أو الحقول اللي بتتغير
 * @returns دالة بترجّع نص المدخل بعد التعديل
 */
function edit<K extends keyof StatementMonthRows>(
  key: K,
  index: number,
  change: Partial<StatementMonthRows[K][number]>,
): Mutation {
  return () => {
    const rows = fullRows();
    const list: readonly object[] = rows[key];
    const next = list.map((item, position) => (position === index ? { ...item, ...change } : item));
    return JSON.stringify(
      buildCanonicalInput(PERIOD, { ...rows, [key]: next } as StatementMonthRows),
    );
  };
}

const SARA_VERSION = 0;
const NOOR_VERSION = 3;

/** خطوتا شرائح نور كما في `fullRows()`، عشان كل تعديل يمس حقلاً واحداً. */
const FIRST_STEP = {
  from: { kind: 'AMOUNT', value: 100_000n },
  calc: { kind: 'PCT', value: 500n },
} as const;
const SECOND_STEP = {
  from: { kind: 'AMOUNT', value: 200_000n },
  calc: { kind: 'FIXED', value: 3_000n },
} as const;

/**
 * يعدّل شرائح إصدار نور بتعديل واحد.
 *
 * @param change الحقل أو الحقول اللي بتتغير في الشرائح
 * @returns دالة التعديل
 */
function noorTiers(change: Record<string, unknown>): Mutation {
  const tiers = {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [FIRST_STEP, SECOND_STEP],
    ...change,
  };
  return edit('versions', NOOR_VERSION, { tiers } as Partial<CommissionPlanVersion>);
}

/**
 * تعديلات البنود والبيع والبقشيش والراتب.
 *
 * @returns التعديلات
 */
function rowMutations(): Record<string, Mutation> {
  const lines = 'employees[].lines[].';
  const sales = 'employees[].sales[].';
  const tips = 'employees[].tips[].';
  return {
    period: () => JSON.stringify(buildCanonicalInput('2026-11', fullRows())),
    'employees[].employee_id': edit('lines', 0, { employeeId: 'employee-zed' }),
    [`${lines}line_id`]: edit('lines', 0, { lineId: 'line-9' }),
    [`${lines}revision`]: edit('lines', 0, { revision: 5n }),
    [`${lines}occurred_at`]: edit('lines', 0, { occurredAt: 1_790_000_000_000_009n }),
    [`${lines}recorded_at`]: edit('lines', 0, { recordedAt: 1_790_000_000_000_009n }),
    [`${lines}business_date`]: edit('lines', 0, { businessDate: '2026-10-06' }),
    [`${lines}service_id`]: edit('lines', 0, { serviceId: 'service-9' }),
    [`${lines}net_share`]: edit('lines', 0, { netShare: 100_001n }),
    [`${lines}share_bps`]: edit('lines', 0, { shareBps: 9_999n }),
    [`${lines}counts`]: edit('lines', 0, { counts: false }),
    [`${lines}rule_snapshot.kind`]: edit('lines', 0, { ruleSnapshot: { kind: 'ZERO' } }),
    [`${lines}rule_snapshot.value`]: edit('lines', 0, {
      ruleSnapshot: { kind: 'PCT', value: 501n },
    }),
    [`${sales}sale_id`]: edit('sales', 0, { saleId: 'sale-9' }),
    [`${sales}revision`]: edit('sales', 0, { revision: 7n }),
    [`${sales}business_date`]: edit('sales', 0, { businessDate: '2026-10-11' }),
    [`${sales}price_paid`]: edit('sales', 0, { pricePaid: 50_001n }),
    [`${sales}refunded_amount`]: edit('sales', 0, { refundedAmount: 10_001n }),
    [`${tips}session_id`]: edit('tips', 0, { sessionId: 'session-9' }),
    [`${tips}revision`]: edit('tips', 0, { revision: 2n }),
    [`${tips}method`]: edit('tips', 0, { method: 'CASH' }),
    [`${tips}business_date`]: edit('tips', 0, { businessDate: '2026-10-06' }),
    [`${tips}amount`]: edit('tips', 0, { amount: 6_001n }),
    'employees[].salary': () => {
      const rows = fullRows();
      const salaries = [
        ...rows.salaries,
        { employeeId: 'employee-noor', effectiveFrom: '2026-10-01', amount: 1n, revision: 1n },
      ];
      return JSON.stringify(buildCanonicalInput(PERIOD, { ...rows, salaries }));
    },
    'employees[].salary.effective_from': edit('salaries', 0, { effectiveFrom: '2026-10-02' }),
    'employees[].salary.amount': edit('salaries', 0, { amount: 400_001n }),
    'employees[].salary.revision': edit('salaries', 0, { revision: 4n }),
  };
}

/**
 * تعديلات الإصدارات بشرائحها وأساسيها وبيع الباقة.
 *
 * @returns التعديلات
 */
function planMutations(): Record<string, Mutation> {
  const versions = 'employees[].versions[].';
  return {
    [`${versions}version`]: edit('versions', SARA_VERSION, { version: 2n }),
    [`${versions}effective_from`]: edit('versions', SARA_VERSION, { effectiveFrom: '2026-09-30' }),
    [`${versions}whole_period`]: edit('versions', SARA_VERSION, { wholePeriod: true }),
    [`${versions}repair_period`]: edit('versions', SARA_VERSION, { repairPeriod: PERIOD }),
    [`${versions}created_at`]: edit('versions', SARA_VERSION, {
      createdAt: 1_789_000_000_000_002n,
    }),
    [`${versions}package_sale.enabled`]: edit('versions', SARA_VERSION, {
      packageSale: { enabled: false },
    }),
    [`${versions}package_sale.calc.kind`]: edit('versions', SARA_VERSION, {
      packageSale: { enabled: true, calc: { kind: 'FIXED', value: 1_000n } },
    }),
    [`${versions}package_sale.calc.value`]: edit('versions', SARA_VERSION, {
      packageSale: { enabled: true, calc: { kind: 'PCT', value: 1_001n } },
    }),
    [`${versions}base.enabled`]: edit('versions', NOOR_VERSION, { base: { enabled: false } }),
    [`${versions}base.calc.kind`]: edit('versions', NOOR_VERSION, {
      base: { enabled: true, calc: { kind: 'FIXED', value: 300n } },
    }),
    [`${versions}base.calc.value`]: edit('versions', NOOR_VERSION, {
      base: { enabled: true, calc: { kind: 'PCT', value: 301n } },
    }),
    [`${versions}tiers.enabled`]: edit('versions', NOOR_VERSION, { tiers: { enabled: false } }),
    [`${versions}tiers.mode`]: noorTiers({ mode: 'WHOLE' }),
    [`${versions}tiers.accumulator`]: noorTiers({ accumulator: 'SESSIONS' }),
    [`${versions}tiers.steps[].from.kind`]: noorTiers({
      steps: [{ ...FIRST_STEP, from: { kind: 'SESSIONS', value: 100_000n } }, SECOND_STEP],
    }),
    [`${versions}tiers.steps[].from.value`]: noorTiers({
      steps: [{ ...FIRST_STEP, from: { kind: 'AMOUNT', value: 100_001n } }, SECOND_STEP],
    }),
    [`${versions}tiers.steps[].calc.kind`]: noorTiers({
      steps: [{ ...FIRST_STEP, calc: { kind: 'FIXED', value: 500n } }, SECOND_STEP],
    }),
    [`${versions}tiers.steps[].calc.value`]: noorTiers({
      steps: [{ ...FIRST_STEP, calc: { kind: 'PCT', value: 501n } }, SECOND_STEP],
    }),
  };
}

/**
 * تعديلات التجاوزات والتصحيحات والموقوفة والمرحّلات.
 *
 * @returns التعديلات
 */
function adjustmentMutations(): Record<string, Mutation> {
  const overrides = 'employees[].overrides[].';
  const corrections = 'employees[].corrections[].';
  return {
    [`${overrides}id`]: edit('overrides', 0, { id: 'override-9' }),
    [`${overrides}service_id`]: edit('overrides', 0, { serviceId: 'service-8' }),
    [`${overrides}effective_from`]: edit('overrides', 0, { effectiveFrom: '2026-10-02' }),
    [`${overrides}created_at`]: edit('overrides', 0, { createdAt: 1_789_000_000_000_009n }),
    [`${overrides}rule.kind`]: edit('overrides', 0, { rule: { kind: 'ZERO' } }),
    [`${overrides}rule.value`]: edit('overrides', 0, { rule: { kind: 'PCT', value: 1_501n } }),
    [`${corrections}source_period`]: edit('corrections', 0, { sourcePeriod: '2026-08' }),
    [`${corrections}source_ref`]: edit('corrections', 0, { sourceRef: 'line:old-2' }),
    [`${corrections}kind`]: edit('corrections', 0, { kind: 'SALE' }),
    [`${corrections}amount`]: edit('corrections', 0, { amount: 3_001n }),
    [`${corrections}previous_amount`]: edit('corrections', 0, { previousAmount: 1n }),
    [`${corrections}new_amount`]: edit('corrections', 0, { newAmount: 3_001n }),
    [`${corrections}generation`]: edit('corrections', 0, { generation: 2n }),
    'employees[].blocked_corrections[].source_period': edit('blocked', 0, {
      sourcePeriod: '2026-06',
    }),
    'employees[].blocked_corrections[].code': edit('blocked', 0, { code: 'NO_SALARY' }),
    'employees[].carries[].source_statement_id': edit('carries', 0, {
      sourceStatementId: 'statement-x',
    }),
    'employees[].carries[].kind': edit('carries', 0, { kind: 'TIP_CARD' }),
    'employees[].carries[].amount': edit('carries', 0, { amount: -5_001n }),
  };
}

/**
 * كل حقل بتبصمه بصمة المدخلات، تعديله لوحده، بمفتاح مسار الورقة في القيمة القياسية. اختبار اكتمال
 * القايمة بيقارن مفاتيحها بأوراق القيمة المكتوبة بإيدي، فحقل اتشال من المنشئ بيفضل له مفتاح هنا
 * ويفشل الاختبار.
 *
 * @returns تعديل لكل حقل
 */
export function canonicalMutations(): Record<string, Mutation> {
  return { ...rowMutations(), ...planMutations(), ...adjustmentMutations() };
}

/**
 * يعيد ترتيب كل قايمة بحيث صفوف الموظفتين تتداخل (الفردي الأول ثم الزوجي)، عشان يثبت إن البناء
 * بعد التجميع بالموظفة مش بيعتمد على ترتيب الإدخال.
 *
 * @param rows صفوف الشهر
 * @returns نفس الصفوف بترتيب مختلف
 */
export function interleaved(rows: StatementMonthRows): StatementMonthRows {
  const reorder = <T>(list: readonly T[]): T[] => [
    ...list.filter((_item, index) => index % 2 === 1),
    ...list.filter((_item, index) => index % 2 === 0),
  ];
  return {
    lines: reorder(rows.lines),
    sales: reorder(rows.sales),
    tips: reorder(rows.tips),
    salaries: reorder(rows.salaries),
    versions: reorder(rows.versions),
    overrides: reorder(rows.overrides),
    corrections: reorder(rows.corrections),
    blocked: reorder(rows.blocked),
    carries: reorder(rows.carries),
  };
}
