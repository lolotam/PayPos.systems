import type {
  AssembledCommissionPeriod,
  CommissionPeriodProjection,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
import type { CommissionPeriodInput, CommissionSalary } from './plan-types.ts';
import { selectSalaryEntryOnLastDay } from './salary-thresholds.ts';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function getPeriodLastDay(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = month === 2 && isLeapYear ? 29 : (MONTH_DAYS[month - 1] ?? 0);
  return `${period}-${String(days).padStart(2, '0')}`;
}

/**
 * يجمع مدخل computePeriod لموظفة وشهر من إسقاط أوسع دون تسعير أي مصدر.
 * لا يدخل المحرك إلا بنود وبيع ACTIVE للموظفة والشهر، وتمر الإكراميات والتصحيحات بلا تسعير وفق D-1.
 * تحفظ الأنواع العامة حقول المستدعي مثل revision والفرع لأن البصمة وفلتر الفروع يحتاجانها.
 *
 * @param projection صفوف الموظفة والفترة مع المرشحين من بقية الموظفين والشهور
 * @returns مدخل المحرك والصفوف المختارة بأنواع المستدعي والإكراميات والتصحيحات بترتيبها
 */
export function assembleCommissionPeriodInput<
  L extends ProjectedCommissionLine = ProjectedCommissionLine,
  S extends ProjectedPackageSale = ProjectedPackageSale,
  Sal extends CommissionSalary = CommissionSalary,
  T extends ProjectedCommissionTip = ProjectedCommissionTip,
  C extends ReceivedCommissionCorrection = ReceivedCommissionCorrection,
>(
  projection: CommissionPeriodProjection<L, S, Sal, T, C>,
): AssembledCommissionPeriod<L, S, Sal, T, C> {
  if (!PERIOD_PATTERN.test(projection.period)) {
    throw new RangeError('Commission period must use YYYY-MM with a valid month');
  }
  const periodLastDay = getPeriodLastDay(projection.period);
  const salary = selectSalaryEntryOnLastDay(
    projection.employeeId,
    periodLastDay,
    projection.salaries,
  );
  const lines = projection.lines.filter(
    (line) =>
      line.status === 'ACTIVE' &&
      line.employeeId === projection.employeeId &&
      line.businessDate.slice(0, 7) === projection.period,
  );
  const sales = projection.sales.filter(
    (sale) =>
      sale.status === 'ACTIVE' &&
      sale.sellerEmployeeId === projection.employeeId &&
      sale.businessDate.slice(0, 7) === projection.period,
  );
  const versions = projection.versions.filter(
    (version) =>
      version.employeeId === projection.employeeId && version.effectiveFrom <= periodLastDay,
  );
  const overrides = projection.overrides.filter(
    (override) =>
      override.employeeId === projection.employeeId && override.effectiveFrom <= periodLastDay,
  );
  const tips = projection.tips.filter(
    (tip) =>
      tip.employeeId === projection.employeeId &&
      tip.businessDate.slice(0, 7) === projection.period,
  );
  const corrections = projection.corrections.filter(
    (correction) =>
      correction.employeeId === projection.employeeId &&
      correction.targetPeriod === projection.period,
  );
  const input: CommissionPeriodInput = {
    employeeId: projection.employeeId,
    period: projection.period,
    periodLastDay,
    lines,
    sales,
    versions,
    overrides,
    salaries: salary === null ? [] : [salary],
  };
  return { input, lines, sales, salary, tips, corrections };
}
