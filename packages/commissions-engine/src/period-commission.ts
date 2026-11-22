import { advanceAmountAccumulator } from './amount-accumulator.ts';
import { computeLineCommission } from './line-commission.ts';
import { orderCommissionLines } from './line-order.ts';
import { computePackageSaleCommission } from './package-sale-commission.ts';
import type {
  CommissionPeriodInput,
  CommissionPeriodResult,
  CommissionPlanVersion,
  PeriodCommissionLine,
  ResolvedCommissionPlan,
} from './plan-types.ts';
import { selectCommissionPlanVersion } from './plan-version.ts';
import { resolveCommissionPlan, selectSalaryOnLastDay } from './salary-thresholds.ts';
import { resolveServiceCommissionRule } from './service-rule.ts';

type Accumulators = { AMOUNT: bigint; SESSIONS: bigint };

/**
 * فشل تسعير مصدر واحد: خطة ناقصة أو راتب ناقص. الفشل مربوط بمصدره عشان القارئ
 * على مستوى الفروع يقدر يفصل فشل مصدر ظاهر عن فشل مصدر مخفي (CS-Q20)،
 * ومجمّع الشهر بيتحسب برضه عشان مواضع الشرائح ما تتقادش لكل فرع (CS-Q24).
 */
export interface CommissionPricingFailure {
  /** مرجع المصدر: `line:<id>` أو `sale:<id>`. */
  readonly sourceRef: string;
  readonly code: 'NO_PLAN' | 'NO_SALARY';
}

/**
 * نتيجة التسعير المفصّلة: مبلغ لكل مصدر ومجموع المصادر المسعّرة، وفشل كل مصدر
 * على حدة بدل فشل الفترة كلها. الفشل ما بيلغيش مصادر تانية، لكنه بيمنع النتيجة
 * الجزئية في `computePeriod`.
 */
export interface CommissionPeriodDetailedResult {
  readonly perSource: Map<string, bigint>;
  readonly total: bigint;
  readonly failures: readonly CommissionPricingFailure[];
}

function advance(before: Accumulators, line: PeriodCommissionLine): Accumulators {
  return {
    AMOUNT: advanceAmountAccumulator(before.AMOUNT, line),
    SESSIONS: before.SESSIONS + (line.counts ? 1n : 0n),
  };
}

function resolveForSource(
  input: CommissionPeriodInput,
  date: string,
  salary: bigint | null,
):
  | { ok: true; version: CommissionPlanVersion; plan: ResolvedCommissionPlan }
  | { ok: false; code: 'NO_PLAN' | 'NO_SALARY' } {
  const version = selectCommissionPlanVersion(input.employeeId, date, input.versions);
  if (version === null) return { ok: false, code: 'NO_PLAN' };
  const resolved = resolveCommissionPlan(version, salary);
  return resolved.ok ? { ok: true, version, plan: resolved.plan } : resolved;
}

function priceLines(
  input: CommissionPeriodInput,
  lines: readonly PeriodCommissionLine[],
  salary: bigint | null,
  perSource: Map<string, bigint>,
  failures: CommissionPricingFailure[],
): void {
  const final = lines.reduce(advance, { AMOUNT: 0n, SESSIONS: 0n });
  let before = { AMOUNT: 0n, SESSIONS: 0n };
  for (const line of lines) {
    const rule = resolveServiceCommissionRule(line, input.overrides);
    let plan: ResolvedCommissionPlan | null = null;
    if (rule.kind === 'FOLLOW_PLAN') {
      const selected = resolveForSource(input, line.businessDate, salary);
      if (!selected.ok) {
        // فشل المصدر بيتسجل بمصدره، والبند كمان بيدخل المجمّع لأنه جزء من الشهر
        // حتى لو ما اتسعرش؛ كده مواضع الشرائح ما بتتغيّرش بإخفاء مصدر (CS-Q24).
        failures.push({ sourceRef: `line:${line.lineId}`, code: selected.code });
        before = advance(before, line);
        continue;
      }
      plan = selected.plan;
    }
    const accumulator = plan?.tiers.enabled ? plan.tiers.accumulator : 'AMOUNT';
    const priced = computeLineCommission(line, rule, plan, before[accumulator], final[accumulator]);
    if (!priced.ok) {
      failures.push({ sourceRef: `line:${line.lineId}`, code: priced.code });
      before = advance(before, line);
      continue;
    }
    perSource.set(`line:${line.lineId}`, priced.amount);
    before = advance(before, line);
  }
}

function priceSales(
  input: CommissionPeriodInput,
  salary: bigint | null,
  perSource: Map<string, bigint>,
  failures: CommissionPricingFailure[],
): void {
  for (const sale of input.sales) {
    if (
      sale.sellerEmployeeId !== input.employeeId ||
      sale.businessDate.slice(0, 7) !== input.period
    ) {
      continue;
    }
    // D-57 (SPEC §5، 012 requirement 6): خطة مختارة بحدود راتب مضاعف بتحتاج
    // راتب حتى لو المصدر بيع، وغياب الخطة يفضل NO_PLAN حتى للبيع المجاني.
    // الفشل بيتسجل بمصدره عشان القارئ على مستوى الفروع يفصل فشل مصدر ظاهر عن
    // فشل مصدر مخفي (CS-Q20) من غير ما يمس المجمّع (CS-Q24).
    const selected = resolveForSource(input, sale.businessDate, salary);
    if (!selected.ok) {
      failures.push({ sourceRef: `sale:${sale.saleId}`, code: selected.code });
      continue;
    }
    const priced = computePackageSaleCommission(sale, selected.version);
    if (!priced.ok) {
      failures.push({ sourceRef: `sale:${sale.saleId}`, code: priced.code });
      continue;
    }
    perSource.set(`sale:${sale.saleId}`, priced.amount);
  }
}

/**
 * يسعّر فترة موظفة ويقسّم الفشل لكل مصدر على حدة: البيع مستقل والمجمّع يستمر عبر
 * الإصدارات وقواعد الخدمة. خطأ الإعداد بيمنع إرجاع عمولة جزئية في `computePeriod`،
 * والنسخة المفصّلة بتفصل فشل كل مصدر عشان القارئ يفلتره بنطاقه.
 *
 * @param input إسقاطات نشطة متقاربة وتواريخ نشاط محسومة لفترة موظفة واحدة
 * @returns مبلغ لكل مصدر ومجموع المقربات مع فشل كل مصدر على حدة
 */
export function computePeriodDetailed(
  input: CommissionPeriodInput,
): CommissionPeriodDetailedResult {
  const lines = orderCommissionLines(
    input.lines.filter(
      (line) =>
        line.employeeId === input.employeeId && line.businessDate.slice(0, 7) === input.period,
    ),
  );
  const salary = selectSalaryOnLastDay(input.employeeId, input.periodLastDay, input.salaries);
  const perSource = new Map<string, bigint>();
  const failures: CommissionPricingFailure[] = [];
  priceLines(input, lines, salary, perSource, failures);
  priceSales(input, salary, perSource, failures);
  const total = [...perSource.values()].reduce((sum, amount) => sum + amount, 0n);
  return { perSource, total, failures };
}

/**
 * يعيد حساب فترة موظفة صافية؛ البيع مستقل والمجمّع يستمر عبر الإصدارات وقواعد الخدمة.
 * الأخطاء المسماة تمنع إرجاع عمولة جزئية، وWHOLE يقرأ المجمّع النهائي لكل خطة مختارة.
 *
 * @param input إسقاطات نشطة متقاربة وتواريخ نشاط محسومة لفترة موظفة واحدة
 * @returns مبلغ لكل مصدر ومجموع المقربات أو NO_PLAN وNO_SALARY وفق D-57
 */
export function computePeriod(input: CommissionPeriodInput): CommissionPeriodResult {
  const detailed = computePeriodDetailed(input);
  const first = detailed.failures[0];
  if (first !== undefined) return { ok: false, code: first.code };
  return { ok: true, perSource: detailed.perSource, total: detailed.total };
}
