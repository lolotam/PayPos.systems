import type {
  AssembledCommissionPeriod,
  CommissionPeriodProjection,
  IncomingCommissionCarry,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
import type {
  CommissionPeriodInput,
  CommissionPlanVersion,
  CommissionSalary,
} from './plan-types.ts';
import { selectSalaryEntryOnLastDay } from './salary-thresholds.ts';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * يتحقق من الشهر ويرجّع آخر يوم فيه، مرة واحدة. بيرفض أي شهر مش بصيغة YYYY-MM بشهر صالح، وسنة
 * 0000 كمان، زي قيد الشهر في جداول العمولة (to_date مش بيعرف يحوّلها).
 *
 * @param period الشهر المطلوب بصيغة YYYY-MM
 * @returns آخر يوم في الشهر بصيغة YYYY-MM-DD؛ بيرمي RangeError لو الشهر غلط
 */
export function commissionPeriodLastDay(period: string): string {
  if (!PERIOD_PATTERN.test(period) || period.startsWith('0000-')) {
    throw new RangeError('Commission period must use YYYY-MM with a valid month');
  }
  return getPeriodLastDay(period);
}

function getPeriodLastDay(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthDays = MONTH_DAYS[month - 1];
  if (monthDays === undefined) {
    throw new RangeError('Commission period must use YYYY-MM with a valid month');
  }
  const days = month === 2 && isLeapYear ? 29 : monthDays;
  return `${period}-${String(days).padStart(2, '0')}`;
}

/**
 * المصدر بيدخل تسعير الشهر لو ساري وتاريخ عمله جوه الشهر.
 *
 * @param source البند أو البيع بحالة إسقاطه وتاريخ عمله
 * @param source.status حالة الإسقاط
 * @param source.businessDate تاريخ العمل بصيغة YYYY-MM-DD
 * @param period الشهر بصيغة YYYY-MM
 * @returns هل المصدر ساري وفي الشهر
 */
export function countsInPeriod(
  source: { readonly status: string; readonly businessDate: string },
  period: string,
): boolean {
  return source.status === 'ACTIVE' && source.businessDate.slice(0, 7) === period;
}

/**
 * نسخة الخطة تسري للموظفة وبتاريخ سريانها لآخر يوم الشهر، ونسخة الإصلاح تسري
 * في شهرها بس وده بيتحدّد بـ repair_period مش بتاريخ السريان (D-12, CS-Q11).
 *
 * @param version إصدار الخطة المرشح
 * @param employeeId الموظفة صاحبة الخطة
 * @param periodLastDay آخر يوم نشاط في الفترة
 * @param period الشهر بصيغة YYYY-MM
 * @returns هل الإصدار ينطبق على الفترة
 */
function appliesToPeriod(
  version: CommissionPlanVersion,
  employeeId: string,
  periodLastDay: string,
  period: string,
): boolean {
  if (version.employeeId !== employeeId) return false;
  // نسخة الإصلاح تخص شهرها بس، فنسخة إصلاح شهر تاني ما بتدخلش حتى لو تاريخ سريانها قبل آخر يوم.
  return version.repairPeriod === null
    ? version.effectiveFrom <= periodLastDay
    : version.repairPeriod === period;
}

/**
 * يجمع مدخل computePeriod لموظفة وشهر من إسقاط أوسع دون تسعير أي مصدر.
 * لا يدخل المحرك إلا بنود وبيع ACTIVE للموظفة والشهر، وتمر الإكراميات والتصحيحات بلا تسعير وفق D-1.
 * تحفظ الأنواع العامة حقول المستدعي مثل revision والفرع لأن البصمة وفلتر الفروع يحتاجانها.
 * المرحّلات (D-22) بتعدّي زي التصحيحات بلا تسعير: اللي هدفها الشهر ده وللموظفة دي.
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
  Cr extends IncomingCommissionCarry = IncomingCommissionCarry,
>(
  projection: CommissionPeriodProjection<L, S, Sal, T, C, Cr>,
): AssembledCommissionPeriod<L, S, Sal, T, C, Cr> {
  return assembleForLastDay(projection, commissionPeriodLastDay(projection.period));
}

/**
 * نفس `assembleCommissionPeriodInput` لمتصل تحقق من الشهر وحسب آخر يوم فيه قبل كده (مرة لكل
 * شهر مش لكل موظفة)؛ الاختيار واحد والنتيجة واحدة.
 *
 * @param projection صفوف الموظفة والفترة
 * @param periodLastDay آخر يوم في الشهر من `commissionPeriodLastDay`
 * @returns مدخل المحرك والصفوف المختارة
 */
export function assembleForLastDay<
  L extends ProjectedCommissionLine = ProjectedCommissionLine,
  S extends ProjectedPackageSale = ProjectedPackageSale,
  Sal extends CommissionSalary = CommissionSalary,
  T extends ProjectedCommissionTip = ProjectedCommissionTip,
  C extends ReceivedCommissionCorrection = ReceivedCommissionCorrection,
  Cr extends IncomingCommissionCarry = IncomingCommissionCarry,
>(
  projection: CommissionPeriodProjection<L, S, Sal, T, C, Cr>,
  periodLastDay: string,
): AssembledCommissionPeriod<L, S, Sal, T, C, Cr> {
  const salary = selectSalaryEntryOnLastDay(
    projection.employeeId,
    periodLastDay,
    projection.salaries,
  );
  const lines = projection.lines.filter(
    (line) => line.employeeId === projection.employeeId && countsInPeriod(line, projection.period),
  );
  const sales = projection.sales.filter(
    (sale) =>
      sale.sellerEmployeeId === projection.employeeId && countsInPeriod(sale, projection.period),
  );
  const versions = projection.versions.filter((version) =>
    appliesToPeriod(version, projection.employeeId, periodLastDay, projection.period),
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
  const carries = (projection.carries ?? []).filter(
    (carry) =>
      carry.employeeId === projection.employeeId && carry.targetPeriod === projection.period,
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
  return { input, lines, sales, salary, tips, corrections, carries };
}
