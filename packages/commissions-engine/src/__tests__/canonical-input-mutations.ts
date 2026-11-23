import { buildCanonicalInput } from '../canonical-input.ts';
import type { CommissionPlanVersion } from '../plan-types.ts';
import { fullRows } from './canonical-input-expected.ts';
import { PERIOD, type StatementMonthRows } from './statement-fixtures.ts';

/**
 * تعديل واحد على حقل واحد من `fullRows()`.
 * - `field`: مسار الورقة العام (`[]` لكل عنصر قايمة)، وبيتقارن بأوراق القيمة المكتوبة بإيدي.
 * - `ids`: هوية الصف الأساسية لكل `[]` في `field` بالترتيب (الموظفة، ثم الصف، ثم خطوة الشريحة).
 * - `row`: مسار الصف العام، وبتتبني عليه `alsoChanges`.
 * - `alsoChanges`: الأوراق (نسبةً للصف) اللي بتتغير حتماً مع الحقل: قيمة القاعدة بتتكتب حسب
 *   نوعها، وحقل اتشال بيشيل أوراقه. أي ورقة غيرها بتتغير بتفشل الاختبار.
 * - `moves`: التعديل بينقل صفاً لموظفة تانية، فمفيش عزل ممكن وله اختباره.
 */
export interface FieldMutation {
  readonly field: string;
  readonly label?: string;
  readonly run: () => string;
  readonly ids: readonly string[];
  readonly row: string;
  readonly alsoChanges?: readonly string[];
  readonly moves?: true;
}

type Extra = {
  alsoChanges?: readonly string[];
  moves?: true;
  label?: string;
  stepIds?: readonly string[];
};

const ROW_PATH: Record<keyof StatementMonthRows, string> = {
  lines: 'employees[].lines[]',
  sales: 'employees[].sales[]',
  tips: 'employees[].tips[]',
  salaries: 'employees[]',
  versions: 'employees[].versions[]',
  overrides: 'employees[].overrides[]',
  corrections: 'employees[].corrections[]',
  blocked: 'employees[].blocked_corrections[]',
  carries: 'employees[].carries[]',
};

/**
 * هوية الصف الأساسية كما بتتكتب في المسارات: الموظفة، ثم الصف.
 *
 * @param key القايمة
 * @param row الصف من `fullRows()`
 * @returns الهويات بالترتيب
 */
function identitiesOf(key: keyof StatementMonthRows, row: Record<string, unknown>): string[] {
  const employee = String(row['employeeId'] ?? row['sellerEmployeeId']);
  const rowId: Record<keyof StatementMonthRows, string> = {
    lines: String(row['lineId']),
    sales: String(row['saleId']),
    tips: `${String(row['sessionId'])}:${String(row['method'])}`,
    salaries: '',
    versions: String(row['version']),
    overrides: String(row['id']),
    corrections: `${String(row['sourcePeriod'])}|${String(row['sourceRef'])}|${String(row['generation'])}`,
    blocked: String(row['sourcePeriod']),
    carries: `${String(row['sourceStatementId'])}:${String(row['kind'])}`,
  };
  return key === 'salaries' ? [employee] : [employee, rowId[key]];
}

/**
 * يعدّل عنصر واحد في قايمة من `fullRows()` بتعديل واحد.
 *
 * @param field مسار الورقة العام
 * @param key القايمة
 * @param index موضع العنصر في `fullRows()`
 * @param change الحقل أو الحقول اللي بتتغير
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل، أو `moves`، أو هوية الخطوات
 * @returns التعديل
 */
function edit<K extends keyof StatementMonthRows>(
  field: string,
  key: K,
  index: number,
  change: Partial<StatementMonthRows[K][number]>,
  extra: Extra = {},
): FieldMutation {
  const base: readonly object[] = fullRows()[key];
  const run = () => {
    const rows = fullRows();
    const list: readonly object[] = rows[key];
    const next = list.map((item, position) => (position === index ? { ...item, ...change } : item));
    return JSON.stringify(
      buildCanonicalInput(PERIOD, { ...rows, [key]: next } as StatementMonthRows),
    );
  };
  const target = base[index] as Record<string, unknown>;
  const { stepIds = [], ...rest } = extra;
  return {
    field,
    run,
    ids: [...identitiesOf(key, target), ...stepIds],
    row: ROW_PATH[key],
    ...rest,
  };
}

const SARA_VERSION = 0;
const NOOR_VERSION = 3;
const V = 'employees[].versions[].';
const FIRST_STEP = {
  from: { kind: 'AMOUNT', value: 100_000n },
  calc: { kind: 'PCT', value: 500n },
} as const;
const SECOND_STEP = {
  from: { kind: 'AMOUNT', value: 200_000n },
  calc: { kind: 'FIXED', value: 3_000n },
} as const;
const STEP_LEAVES = [0, 1].flatMap((step) =>
  ['from.kind', 'from.value', 'calc.kind', 'calc.value'].map(
    (leaf) => `tiers.steps[${step}].${leaf}`,
  ),
);

/**
 * تعديل شرائح إصدار نور بتعديل واحد.
 *
 * @param field مسار الورقة العام
 * @param change الحقل أو الحقول اللي بتتغير في الشرائح
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل، وهوية الخطوة
 * @returns التعديل
 */
function noorTiers(
  field: string,
  change: Record<string, unknown>,
  extra: Extra = {},
): FieldMutation {
  const tiers = {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [FIRST_STEP, SECOND_STEP],
    ...change,
  };
  return edit(field, 'versions', NOOR_VERSION, { tiers } as Partial<CommissionPlanVersion>, extra);
}

/**
 * تعديلات البنود؛ وقاعدة البند بتتنقل بين نوع بقيمة ونوع بلا قيمة (ZERO وFOLLOW_PLAN) والعكس.
 *
 * @returns التعديلات
 */
function lineMutations(): FieldMutation[] {
  const L = 'employees[].lines[].';
  const kind = `${L}rule_snapshot.kind`;
  const value = ['rule_snapshot.value'];
  return [
    edit('employees[].employee_id', 'lines', 0, { employeeId: 'employee-zed' }, { moves: true }),
    edit(`${L}line_id`, 'lines', 0, { lineId: 'line-1b' }),
    edit(`${L}revision`, 'lines', 0, { revision: 5n }),
    edit(`${L}occurred_at`, 'lines', 0, { occurredAt: 1_790_000_000_000_009n }),
    edit(`${L}recorded_at`, 'lines', 0, { recordedAt: 1_790_000_000_000_009n }),
    edit(`${L}business_date`, 'lines', 0, { businessDate: '2026-10-06' }),
    edit(`${L}service_id`, 'lines', 0, { serviceId: 'service-9' }),
    edit(`${L}net_share`, 'lines', 0, { netShare: 100_001n }),
    edit(`${L}share_bps`, 'lines', 0, { shareBps: 9_999n }),
    edit(`${L}counts`, 'lines', 0, { counts: false }),
    edit(
      kind,
      'lines',
      0,
      { ruleSnapshot: { kind: 'FIXED', value: 500n } },
      { alsoChanges: value, label: 'PCT to FIXED' },
    ),
    edit(
      kind,
      'lines',
      0,
      { ruleSnapshot: { kind: 'ZERO' } },
      { alsoChanges: value, label: 'PCT to ZERO, the value goes' },
    ),
    edit(
      kind,
      'lines',
      1,
      { ruleSnapshot: { kind: 'PCT', value: 500n } },
      { alsoChanges: value, label: 'FOLLOW_PLAN to PCT, a value appears' },
    ),
    edit(`${L}rule_snapshot.value`, 'lines', 0, { ruleSnapshot: { kind: 'PCT', value: 501n } }),
  ];
}

/**
 * تعديلات البيع والبقشيش والراتب. المعرّفات بتتبدّل لقيمة بتفضل في نفس موضع الترتيب، وطريقة دفع
 * البقشيش بتتعدّل في بقشيش جلسته الوحيدة.
 *
 * @returns التعديلات
 */
function saleTipSalaryMutations(): FieldMutation[] {
  const S = 'employees[].sales[].';
  const T = 'employees[].tips[].';
  const salary = 'employees[].salary';
  return [
    edit(`${S}sale_id`, 'sales', 0, { saleId: 'sale-1b' }),
    edit(`${S}revision`, 'sales', 0, { revision: 7n }),
    edit(`${S}business_date`, 'sales', 0, { businessDate: '2026-10-11' }),
    edit(`${S}price_paid`, 'sales', 0, { pricePaid: 50_001n }),
    edit(`${S}refunded_amount`, 'sales', 0, { refundedAmount: 10_001n }),
    edit(`${T}session_id`, 'tips', 0, { sessionId: 'session-0' }),
    edit(`${T}revision`, 'tips', 0, { revision: 2n }),
    edit(`${T}method`, 'tips', 2, { method: 'CASH' }),
    edit(`${T}business_date`, 'tips', 0, { businessDate: '2026-10-06' }),
    edit(`${T}amount`, 'tips', 0, { amount: 6_001n }),
    {
      ...edit(
        salary,
        'salaries',
        0,
        {},
        { alsoChanges: ['salary.effective_from', 'salary.revision'] },
      ),
      ids: ['employee-noor'],
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
    },
    edit(`${salary}.effective_from`, 'salaries', 0, { effectiveFrom: '2026-10-02' }),
    edit(`${salary}.revision`, 'salaries', 0, { revision: 4n }),
  ];
}

/**
 * تعديلات إصدار سارة الأول: تواريخه وعلاماته وبيع الباقة.
 *
 * @returns التعديلات
 */
function saraPlanMutations(): FieldMutation[] {
  const p = (field: string, change: Partial<CommissionPlanVersion>, extra: Extra = {}) =>
    edit(`${V}${field}`, 'versions', SARA_VERSION, change, extra);
  const sale = ['package_sale.calc.kind', 'package_sale.calc.value'];
  return [
    p('version', { version: 2n }),
    p('effective_from', { effectiveFrom: '2026-09-30' }),
    p('whole_period', { wholePeriod: true }),
    p('repair_period', { repairPeriod: PERIOD }),
    p('created_at', { createdAt: 1_789_000_000_000_002n }),
    p('package_sale.enabled', { packageSale: { enabled: false } }, { alsoChanges: sale }),
    p(
      'package_sale.calc.kind',
      { packageSale: { enabled: true, calc: { kind: 'FIXED', value: 1_000n } } },
      { alsoChanges: ['package_sale.calc.value'] },
    ),
    p('package_sale.calc.value', {
      packageSale: { enabled: true, calc: { kind: 'PCT', value: 1_001n } },
    }),
  ];
}

/**
 * تعديلات إصدار نور: الأساسي والشرائح بخطوتيها.
 *
 * @returns التعديلات
 */
function noorPlanMutations(): FieldMutation[] {
  const n = (field: string, change: Partial<CommissionPlanVersion>, extra: Extra = {}) =>
    edit(`${V}${field}`, 'versions', NOOR_VERSION, change, extra);
  const step = { stepIds: ['0'] };
  return [
    n(
      'base.enabled',
      { base: { enabled: false } },
      { alsoChanges: ['base.calc.kind', 'base.calc.value'] },
    ),
    n(
      'base.calc.kind',
      { base: { enabled: true, calc: { kind: 'FIXED', value: 300n } } },
      { alsoChanges: ['base.calc.value'] },
    ),
    n('base.calc.value', { base: { enabled: true, calc: { kind: 'PCT', value: 301n } } }),
    n(
      'tiers.enabled',
      { tiers: { enabled: false } },
      { alsoChanges: ['tiers.mode', 'tiers.accumulator', ...STEP_LEAVES] },
    ),
    noorTiers(`${V}tiers.mode`, { mode: 'WHOLE' }),
    noorTiers(`${V}tiers.accumulator`, { accumulator: 'SESSIONS' }),
    noorTiers(
      `${V}tiers.steps[].from.kind`,
      { steps: [{ ...FIRST_STEP, from: { kind: 'SESSIONS', value: 100_000n } }, SECOND_STEP] },
      { ...step, alsoChanges: ['tiers.steps[0].from.value'] },
    ),
    noorTiers(
      `${V}tiers.steps[].from.value`,
      { steps: [{ ...FIRST_STEP, from: { kind: 'AMOUNT', value: 100_001n } }, SECOND_STEP] },
      step,
    ),
    noorTiers(
      `${V}tiers.steps[].calc.kind`,
      { steps: [{ ...FIRST_STEP, calc: { kind: 'FIXED', value: 500n } }, SECOND_STEP] },
      { ...step, alsoChanges: ['tiers.steps[0].calc.value'] },
    ),
    noorTiers(
      `${V}tiers.steps[].calc.value`,
      { steps: [{ ...FIRST_STEP, calc: { kind: 'PCT', value: 501n } }, SECOND_STEP] },
      step,
    ),
  ];
}

/**
 * تعديلات التجاوزات والتصحيحات والموقوفة والمرحّلات؛ وقاعدة التجاوز بتتنقل بين نوع بقيمة ونوع
 * بلا قيمة والعكس.
 *
 * @returns التعديلات
 */
function adjustmentMutations(): FieldMutation[] {
  const O = 'employees[].overrides[].';
  const C = 'employees[].corrections[].';
  const B = 'employees[].blocked_corrections[].';
  const R = 'employees[].carries[].';
  const value = ['rule.value'];
  return [
    edit(`${O}id`, 'overrides', 0, { id: 'override-1b' }),
    edit(`${O}service_id`, 'overrides', 0, { serviceId: 'service-8' }),
    edit(`${O}effective_from`, 'overrides', 0, { effectiveFrom: '2026-10-02' }),
    edit(`${O}created_at`, 'overrides', 0, { createdAt: 1_789_000_000_000_009n }),
    edit(
      `${O}rule.kind`,
      'overrides',
      0,
      { rule: { kind: 'FIXED', value: 1_500n } },
      { alsoChanges: value, label: 'PCT to FIXED' },
    ),
    edit(
      `${O}rule.kind`,
      'overrides',
      0,
      { rule: { kind: 'ZERO' } },
      { alsoChanges: value, label: 'PCT to ZERO, the value goes' },
    ),
    edit(
      `${O}rule.kind`,
      'overrides',
      2,
      { rule: { kind: 'FIXED', value: 1_000n } },
      { alsoChanges: value, label: 'ZERO to FIXED, a value appears' },
    ),
    edit(`${O}rule.value`, 'overrides', 0, { rule: { kind: 'PCT', value: 1_501n } }),
    edit(`${C}source_period`, 'corrections', 0, { sourcePeriod: '2026-08' }),
    edit(`${C}source_ref`, 'corrections', 0, { sourceRef: 'line:old-1b' }),
    edit(`${C}kind`, 'corrections', 0, { kind: 'SALE' }),
    edit(`${C}amount`, 'corrections', 0, { amount: 3_001n }),
    edit(`${C}previous_amount`, 'corrections', 0, { previousAmount: 1n }),
    edit(`${C}new_amount`, 'corrections', 0, { newAmount: 3_001n }),
    edit(`${C}generation`, 'corrections', 0, { generation: 2n }),
    edit(`${B}source_period`, 'blocked', 0, { sourcePeriod: '2026-09' }),
    edit(`${B}code`, 'blocked', 0, { code: 'NO_SALARY' }),
    edit(`${R}source_statement_id`, 'carries', 2, { sourceStatementId: 'statement-aug2' }),
    edit(`${R}kind`, 'carries', 2, { kind: 'TIP_CARD' }),
    edit(`${R}amount`, 'carries', 2, { amount: -1_001n }),
  ];
}

/**
 * كل حقل بتبصمه بصمة المدخلات، تعديله لوحده (وللقاعدة أكتر من تعديل بين نوع بقيمة وبلا قيمة).
 * اختبار اكتمال القايمة بيقارن حقولها بأوراق القيمة المكتوبة بإيدي (ما عدا `period` وله اختباره)،
 * فحقل اتشال من المنشئ بيفضل له تعديل هنا ويفشل الاختبار.
 *
 * @returns التعديلات
 */
export function canonicalMutations(): FieldMutation[] {
  return [
    ...lineMutations(),
    ...saleTipSalaryMutations(),
    ...saraPlanMutations(),
    ...noorPlanMutations(),
    ...adjustmentMutations(),
  ];
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
