import { buildCanonicalInput } from '../canonical-input.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';
import { fullRows } from './canonical-input-expected.ts';
import { PERIOD, type StatementMonthRows } from './statement-fixtures.ts';

/**
 * تعديل واحد على حقل: `run` بيرجّع نص المدخل بعد التعديل. `alsoChanges` بيسمّي الأوراق اللي
 * بتتغير حتماً مع الحقل (قيمة القاعدة بتتكتب حسب نوعها، وحقل اتشال بيشيل أوراقه)؛ أي ورقة تانية
 * بتتغير بتفشل الاختبار. `moves` لتعديل بينقل صفاً لموظفة تانية فمفيش عزل ممكن.
 */
export interface FieldMutation {
  readonly run: () => string;
  readonly alsoChanges?: readonly string[];
  readonly moves?: true;
}

/**
 * يعدّل عنصر واحد في قايمة من `fullRows()` بتعديل واحد، ويرجّع نص المدخل القياسي بعده.
 *
 * @param key القايمة
 * @param index موضع العنصر في `fullRows()`
 * @param change الحقل أو الحقول اللي بتتغير
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل، أو `moves`
 * @returns التعديل
 */
function edit<K extends keyof StatementMonthRows>(
  key: K,
  index: number,
  change: Partial<StatementMonthRows[K][number]>,
  extra: Omit<FieldMutation, 'run'> = {},
): FieldMutation {
  const run = () => {
    const rows = fullRows();
    const list: readonly object[] = rows[key];
    const next = list.map((item, position) => (position === index ? { ...item, ...change } : item));
    return JSON.stringify(
      buildCanonicalInput(PERIOD, { ...rows, [key]: next } as StatementMonthRows),
    );
  };
  return { run, ...extra };
}

const SARA_VERSION = 0;
const NOOR_VERSION = 3;
const V = 'employees[].versions[].';

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
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل
 * @returns التعديل
 */
function noorTiers(change: Record<string, unknown>, extra: readonly string[] = []): FieldMutation {
  const tiers = {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [FIRST_STEP, SECOND_STEP],
    ...change,
  };
  return edit(
    'versions',
    NOOR_VERSION,
    { tiers } as Partial<CommissionPlanVersion>,
    extra.length === 0 ? {} : { alsoChanges: extra.map((leaf) => `${V}tiers.${leaf}`) },
  );
}

/**
 * تعديلات البنود والبيع والبقشيش والراتب. المعرّفات بتتبدّل لقيمة بتفضل في نفس موضع الترتيب،
 * وطريقة دفع البقشيش بتتعدّل في بقشيش جلسته الوحيدة.
 *
 * @returns التعديلات
 */
function rowMutations(): Record<string, FieldMutation> {
  const L = 'employees[].lines[].';
  const S = 'employees[].sales[].';
  const T = 'employees[].tips[].';
  const salary = 'employees[].salary';
  const salaryLeaves = [`${salary}.effective_from`, `${salary}.amount`, `${salary}.revision`];
  return {
    'employees[].employee_id': edit('lines', 0, { employeeId: 'employee-zed' }, { moves: true }),
    [`${L}line_id`]: edit('lines', 0, { lineId: 'line-1b' }),
    [`${L}revision`]: edit('lines', 0, { revision: 5n }),
    [`${L}occurred_at`]: edit('lines', 0, { occurredAt: 1_790_000_000_000_009n }),
    [`${L}recorded_at`]: edit('lines', 0, { recordedAt: 1_790_000_000_000_009n }),
    [`${L}business_date`]: edit('lines', 0, { businessDate: '2026-10-06' }),
    [`${L}service_id`]: edit('lines', 0, { serviceId: 'service-9' }),
    [`${L}net_share`]: edit('lines', 0, { netShare: 100_001n }),
    [`${L}share_bps`]: edit('lines', 0, { shareBps: 9_999n }),
    [`${L}counts`]: edit('lines', 0, { counts: false }),
    [`${L}rule_snapshot.kind`]: edit(
      'lines',
      0,
      { ruleSnapshot: { kind: 'FIXED', value: 500n } },
      { alsoChanges: [`${L}rule_snapshot.value`] },
    ),
    [`${L}rule_snapshot.value`]: edit('lines', 0, { ruleSnapshot: { kind: 'PCT', value: 501n } }),
    [`${S}sale_id`]: edit('sales', 0, { saleId: 'sale-1b' }),
    [`${S}revision`]: edit('sales', 0, { revision: 7n }),
    [`${S}business_date`]: edit('sales', 0, { businessDate: '2026-10-11' }),
    [`${S}price_paid`]: edit('sales', 0, { pricePaid: 50_001n }),
    [`${S}refunded_amount`]: edit('sales', 0, { refundedAmount: 10_001n }),
    [`${T}session_id`]: edit('tips', 0, { sessionId: 'session-0' }),
    [`${T}revision`]: edit('tips', 0, { revision: 2n }),
    [`${T}method`]: edit('tips', 2, { method: 'CASH' }),
    [`${T}business_date`]: edit('tips', 0, { businessDate: '2026-10-06' }),
    [`${T}amount`]: edit('tips', 0, { amount: 6_001n }),
    [salary]: {
      run: () => {
        const rows = fullRows();
        const extra = {
          employeeId: 'employee-noor',
          effectiveFrom: '2026-10-01',
          amount: 1n,
          revision: 1n,
        };
        return JSON.stringify(
          buildCanonicalInput(PERIOD, { ...rows, salaries: [...rows.salaries, extra] }),
        );
      },
      alsoChanges: salaryLeaves,
    },
    [`${salary}.effective_from`]: edit('salaries', 0, { effectiveFrom: '2026-10-02' }),
    [`${salary}.amount`]: edit('salaries', 0, { amount: 400_001n }),
    [`${salary}.revision`]: edit('salaries', 0, { revision: 4n }),
  };
}

/**
 * تعديلات إصدار سارة الأول.
 *
 * @returns التعديلات
 */
function saraPlanMutations(): Record<string, FieldMutation> {
  const sara = (change: Partial<CommissionPlanVersion>, also: readonly string[] = []) =>
    edit(
      'versions',
      SARA_VERSION,
      change,
      also.length === 0 ? {} : { alsoChanges: also.map((leaf) => `${V}${leaf}`) },
    );
  return {
    [`${V}version`]: sara({ version: 2n }),
    [`${V}effective_from`]: sara({ effectiveFrom: '2026-09-30' }),
    [`${V}whole_period`]: sara({ wholePeriod: true }),
    [`${V}repair_period`]: sara({ repairPeriod: PERIOD }),
    [`${V}created_at`]: sara({ createdAt: 1_789_000_000_000_002n }),
    [`${V}package_sale.enabled`]: sara({ packageSale: { enabled: false } }, [
      'package_sale.calc.kind',
      'package_sale.calc.value',
    ]),
    [`${V}package_sale.calc.kind`]: sara(
      { packageSale: { enabled: true, calc: { kind: 'FIXED', value: 1_000n } } },
      ['package_sale.calc.value'],
    ),
    [`${V}package_sale.calc.value`]: sara({
      packageSale: { enabled: true, calc: { kind: 'PCT', value: 1_001n } },
    }),
  };
}

/**
 * تعديلات إصدار نور: الأساسي والشرائح بخطوتيها.
 *
 * @returns التعديلات
 */
function noorPlanMutations(): Record<string, FieldMutation> {
  const noor = (change: Partial<CommissionPlanVersion>, also: readonly string[] = []) =>
    edit(
      'versions',
      NOOR_VERSION,
      change,
      also.length === 0 ? {} : { alsoChanges: also.map((leaf) => `${V}${leaf}`) },
    );
  return {
    [`${V}base.enabled`]: noor({ base: { enabled: false } }, ['base.calc.kind', 'base.calc.value']),
    [`${V}base.calc.kind`]: noor(
      { base: { enabled: true, calc: { kind: 'FIXED', value: 300n } } },
      ['base.calc.value'],
    ),
    [`${V}base.calc.value`]: noor({ base: { enabled: true, calc: { kind: 'PCT', value: 301n } } }),
    [`${V}tiers.enabled`]: noor({ tiers: { enabled: false } }, [
      'tiers.mode',
      'tiers.accumulator',
      'tiers.steps[].from.kind',
      'tiers.steps[].from.value',
      'tiers.steps[].calc.kind',
      'tiers.steps[].calc.value',
    ]),
    [`${V}tiers.mode`]: noorTiers({ mode: 'WHOLE' }),
    [`${V}tiers.accumulator`]: noorTiers({ accumulator: 'SESSIONS' }),
    [`${V}tiers.steps[].from.kind`]: noorTiers(
      { steps: [{ ...FIRST_STEP, from: { kind: 'SESSIONS', value: 100_000n } }, SECOND_STEP] },
      ['steps[].from.value'],
    ),
    [`${V}tiers.steps[].from.value`]: noorTiers({
      steps: [{ ...FIRST_STEP, from: { kind: 'AMOUNT', value: 100_001n } }, SECOND_STEP],
    }),
    [`${V}tiers.steps[].calc.kind`]: noorTiers(
      { steps: [{ ...FIRST_STEP, calc: { kind: 'FIXED', value: 500n } }, SECOND_STEP] },
      ['steps[].calc.value'],
    ),
    [`${V}tiers.steps[].calc.value`]: noorTiers({
      steps: [{ ...FIRST_STEP, calc: { kind: 'PCT', value: 501n } }, SECOND_STEP],
    }),
  };
}

/**
 * تعديلات التجاوزات والتصحيحات والموقوفة والمرحّلات.
 *
 * @returns التعديلات
 */
function adjustmentMutations(): Record<string, FieldMutation> {
  const O = 'employees[].overrides[].';
  const C = 'employees[].corrections[].';
  const B = 'employees[].blocked_corrections[].';
  const R = 'employees[].carries[].';
  return {
    [`${O}id`]: edit('overrides', 0, { id: 'override-1b' }),
    [`${O}service_id`]: edit('overrides', 0, { serviceId: 'service-8' }),
    [`${O}effective_from`]: edit('overrides', 0, { effectiveFrom: '2026-10-02' }),
    [`${O}created_at`]: edit('overrides', 0, { createdAt: 1_789_000_000_000_009n }),
    [`${O}rule.kind`]: edit(
      'overrides',
      0,
      { rule: { kind: 'FIXED', value: 1_500n } },
      { alsoChanges: [`${O}rule.value`] },
    ),
    [`${O}rule.value`]: edit('overrides', 0, { rule: { kind: 'PCT', value: 1_501n } }),
    [`${C}source_period`]: edit('corrections', 0, { sourcePeriod: '2026-08' }),
    [`${C}source_ref`]: edit('corrections', 0, { sourceRef: 'line:old-1b' }),
    [`${C}kind`]: edit('corrections', 0, { kind: 'SALE' }),
    [`${C}amount`]: edit('corrections', 0, { amount: 3_001n }),
    [`${C}previous_amount`]: edit('corrections', 0, { previousAmount: 1n }),
    [`${C}new_amount`]: edit('corrections', 0, { newAmount: 3_001n }),
    [`${C}generation`]: edit('corrections', 0, { generation: 2n }),
    [`${B}source_period`]: edit('blocked', 0, { sourcePeriod: '2026-09' }),
    [`${B}code`]: edit('blocked', 0, { code: 'NO_SALARY' }),
    [`${R}source_statement_id`]: edit('carries', 2, { sourceStatementId: 'statement-aug2' }),
    [`${R}kind`]: edit('carries', 2, { kind: 'TIP_CARD' }),
    [`${R}amount`]: edit('carries', 2, { amount: -1_001n }),
  };
}

/**
 * كل حقل بتبصمه بصمة المدخلات، تعديله لوحده، بمفتاح مسار الورقة في القيمة القياسية (ما عدا `period`
 * وله اختباره). اختبار اكتمال القايمة بيقارن مفاتيحها بأوراق القيمة المكتوبة بإيدي، فحقل اتشال من
 * المنشئ بيفضل له مفتاح هنا ويفشل الاختبار.
 *
 * @returns تعديل لكل حقل
 */
export function canonicalMutations(): Record<string, FieldMutation> {
  return {
    ...rowMutations(),
    ...saraPlanMutations(),
    ...noorPlanMutations(),
    ...adjustmentMutations(),
  };
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

/**
 * يعكس كل قايمة بالكامل، فأي زوج متعادل في الهوية (زي تصحيحين لنفس المصدر بجيل 9 و10) بيتغذّى
 * بالعكس.
 *
 * @param rows صفوف الشهر
 * @returns نفس الصفوف بترتيب معكوس
 */
export function reversed(rows: StatementMonthRows): StatementMonthRows {
  return {
    lines: [...rows.lines].reverse(),
    sales: [...rows.sales].reverse(),
    tips: [...rows.tips].reverse(),
    salaries: [...rows.salaries].reverse(),
    versions: [...rows.versions].reverse(),
    overrides: [...rows.overrides].reverse(),
    corrections: [...rows.corrections].reverse(),
    blocked: [...rows.blocked].reverse(),
    carries: [...rows.carries].reverse(),
  };
}
