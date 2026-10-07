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
): { ok: true } | { ok: false; code: 'NO_PLAN' | 'NO_SALARY' } {
  const final = lines.reduce(advance, { AMOUNT: 0n, SESSIONS: 0n });
  let before = { AMOUNT: 0n, SESSIONS: 0n };
  for (const line of lines) {
    const rule = resolveServiceCommissionRule(line, input.overrides);
    let plan: ResolvedCommissionPlan | null = null;
    if (rule.kind === 'FOLLOW_PLAN') {
      const selected = resolveForSource(input, line.businessDate, salary);
      if (!selected.ok) return selected;
      plan = selected.plan;
    }
    const accumulator = plan?.tiers.enabled ? plan.tiers.accumulator : 'AMOUNT';
    const priced = computeLineCommission(line, rule, plan, before[accumulator], final[accumulator]);
    if (!priced.ok) return priced;
    perSource.set(`line:${line.lineId}`, priced.amount);
    before = advance(before, line);
  }
  return { ok: true };
}

/**
 * يعيد حساب فترة موظفة صافية؛ البيع مستقل والمجمّع يستمر عبر الإصدارات وقواعد الخدمة.
 * الأخطاء المسماة تمنع إرجاع عمولة جزئية، وWHOLE يقرأ المجمّع النهائي لكل خطة مختارة.
 *
 * @param input إسقاطات نشطة متقاربة وتواريخ نشاط محسومة لفترة موظفة واحدة
 * @returns مبلغ لكل مصدر ومجموع المقربات أو NO_PLAN وNO_SALARY وفق D-57
 */
export function computePeriod(input: CommissionPeriodInput): CommissionPeriodResult {
  const lines = orderCommissionLines(
    input.lines.filter(
      (line) =>
        line.employeeId === input.employeeId && line.businessDate.slice(0, 7) === input.period,
    ),
  );
  const salary = selectSalaryOnLastDay(input.employeeId, input.periodLastDay, input.salaries);
  const perSource = new Map<string, bigint>();
  const pricedLines = priceLines(input, lines, salary, perSource);
  if (!pricedLines.ok) return pricedLines;
  for (const sale of input.sales) {
    if (
      sale.sellerEmployeeId !== input.employeeId ||
      sale.businessDate.slice(0, 7) !== input.period
    )
      continue;
    const selected = resolveForSource(input, sale.businessDate, salary);
    if (!selected.ok) return selected;
    const priced = computePackageSaleCommission(sale, selected.version);
    if (!priced.ok) return priced;
    perSource.set(`sale:${sale.saleId}`, priced.amount);
  }
  const total = [...perSource.values()].reduce((sum, amount) => sum + amount, 0n);
  return { ok: true, perSource, total };
}
