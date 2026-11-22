import type { ServiceCommissionOverride } from './commission-types.ts';
import {
  attachedDuring,
  branchesOn,
  collectCorrections,
  collectSources,
  collectTips,
  coveredDays,
  daysInMonth,
  visibleTo,
} from './estimate-visibility.ts';
import { assembleCommissionPeriodInput } from './period-input-assembly.ts';
import { computePeriodDetailed, type CommissionPeriodDetailedResult } from './period-commission.ts';
import type {
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
import type { CommissionPlanVersion, CommissionSalary } from './plan-types.ts';

/**
 * نطاق القارئ على مستوى النشاط (CS-Q20): النشاط كله أو فروع محددة. `businessWide`
 * يعني إن القارئ شايف كل موظفة النشاط وكل صف من صفوفهن.
 */
export interface CommissionEstimateScope {
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
}

/** ارتباط موظفة بفرع بتاريخين: البداية داخلة والنهاية خارجة، والفارغة ارتباط مفتوح. */
export interface CommissionEstimateAttachment {
  readonly employeeId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string | null;
}

/** بند خدمة في شهر الموظفة مع فرعه؛ تاريخ العمل هو مفتاح الفلترة باليوم. */
export interface CommissionEstimateLine extends ProjectedCommissionLine {
  readonly branchId: string;
}

/** بيع باقة في شهر الموظفة مع فرعه؛ الحالة المحفوظة بتتحوّل لحالة المحرك. */
export interface CommissionEstimateSale extends ProjectedPackageSale {
  readonly branchId: string;
}

/** بقشيش الشهر مع فرعه ويومه؛ البقشيش بيعدّي من غير تسعير (D-1). */
export interface CommissionEstimateTip extends ProjectedCommissionTip {
  readonly branchId: string;
}

/** تصحيح مستلم في الشهر: نسبته المجمَّدة وفروعه المجمَّدة بتحددوا رؤيته (FR-040). */
export interface CommissionEstimateCorrection extends ReceivedCommissionCorrection {
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachedBranchIds: readonly string[];
}

/** صفوف الشهر كلها مقروءة مرة واحدة: البنود والبيع والبقشيش والرواتب والإصدارات والتجاوزات والتصحيحات. */
export interface CommissionEstimateMonthRows {
  readonly lines: readonly CommissionEstimateLine[];
  readonly sales: readonly CommissionEstimateSale[];
  readonly tips: readonly CommissionEstimateTip[];
  readonly salaries: readonly CommissionSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly corrections: readonly CommissionEstimateCorrection[];
}

/** مدخلات الإسقاط: النطاق والشهر والموظفات ذات الصفوف وأسماء القارئ. */
export interface CommissionEstimateProjectionInput {
  readonly scope: CommissionEstimateScope;
  readonly period: string;
  /** الموظفات اللاتي عندهن صف في قارئ الأسماء؛ مين مش فيهم ما بتتعرضش. */
  readonly employeeIds: readonly string[];
  readonly month: CommissionEstimateMonthRows;
  readonly attachments: readonly CommissionEstimateAttachment[];
}

/** حالة تسعير شهر الموظفة: OK أو سبب منع التسعير (D-57). */
export type CommissionEstimateStatus = 'OK' | 'NO_PLAN' | 'NO_SALARY';

/** مصدر مسعَّر: البند أو بيع الباقة، بمبلغه وفرع عمله ويومه. */
export interface CommissionEstimateSourceProjection {
  readonly sourceRef: string;
  readonly kind: 'COMMISSION' | 'SALE';
  readonly amount: bigint;
  readonly branchId: string;
  readonly businessDate: string;
  readonly serviceId: string | null;
}

/** بيع الباقة المسعَّر. */
export interface CommissionEstimateSaleProjection {
  readonly saleId: string;
  readonly amount: bigint;
  readonly branchId: string;
  readonly businessDate: string;
}

/** تصحيح مستلم في الشهر، بيعرض بمبلغه المجمد. */
export interface CommissionEstimateCorrectionProjection {
  readonly sourceRef: string;
  readonly kind: 'COMMISSION' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';
  readonly amount: bigint;
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
}

/** تقدير موظفة واحدة: مصادرها المسعّرة وبقشيشها وتصحيحاتها ومجموعها وحالتها. */
export interface CommissionEstimateEmployeeProjection {
  readonly employeeId: string;
  readonly status: CommissionEstimateStatus;
  /** أرقامها جزئية: صف من شهرها خارج نطاق القارئ أو تغطية ناقصة لأيام الشهر. */
  readonly partial: boolean;
  /** null لما ما تسعّرش شهرها؛ المبلغ المجهول ما يتصدقش إنه صفر (FR-021). */
  readonly total: bigint | null;
  readonly sources: readonly CommissionEstimateSourceProjection[];
  readonly sales: readonly CommissionEstimateSaleProjection[];
  readonly tips: { readonly card: bigint; readonly cash: bigint };
  readonly corrections: readonly CommissionEstimateCorrectionProjection[];
}

/** تقدير النشاط لشهر واحد: الموظفات المرئيات ومجموعهن المرئي. */
export interface CommissionEstimateProjection {
  readonly employees: readonly CommissionEstimateEmployeeProjection[];
  /** المجموع جزئي للقارئ على مستوى الفروع؛ القارئ على مستوى النشاط بيشوف الكل. */
  readonly partial: boolean;
  readonly total: bigint | null;
}

/** صفوف شهر موظفة واحدة مجمّعة مرة واحدة، بدل ما كل موظفة تفلتر على المصفوفة كلها. */
interface EmployeeMonth {
  lines: CommissionEstimateLine[];
  sales: CommissionEstimateSale[];
  tips: CommissionEstimateTip[];
  corrections: CommissionEstimateCorrection[];
  salaries: CommissionSalary[];
  versions: CommissionPlanVersion[];
  overrides: ServiceCommissionOverride[];
}

/**
 * يصنع صف موظفة فاضية؛ الصفوف بتتجمّع مرة واحدة قبل الفلترة.
 *
 * @returns صف شهر فاضي
 */
function emptyMonth(): EmployeeMonth {
  return {
    lines: [],
    sales: [],
    tips: [],
    corrections: [],
    salaries: [],
    versions: [],
    overrides: [],
  };
}

/**
 * يجمّع صفوف الشهر بالموظفة مرة واحدة.
 *
 * @param month صفوف الشهر المقروءة
 * @returns صفوف كل موظفة
 */
function groupMonthByEmployee(
  month: CommissionEstimateMonthRows,
): ReadonlyMap<string, EmployeeMonth> {
  const grouped = new Map<string, EmployeeMonth>();
  const of = (employeeId: string): EmployeeMonth => {
    const existing = grouped.get(employeeId);
    if (existing !== undefined) return existing;
    const created = emptyMonth();
    grouped.set(employeeId, created);
    return created;
  };
  for (const line of month.lines) of(line.employeeId).lines.push(line);
  for (const sale of month.sales) {
    if (sale.sellerEmployeeId !== null) of(sale.sellerEmployeeId).sales.push(sale);
  }
  for (const tip of month.tips) of(tip.employeeId).tips.push(tip);
  for (const correction of month.corrections) of(correction.employeeId).corrections.push(correction);
  for (const salary of month.salaries) of(salary.employeeId).salaries.push(salary);
  for (const version of month.versions) of(version.employeeId).versions.push(version);
  for (const override of month.overrides) of(override.employeeId).overrides.push(override);
  return grouped;
}

/**
 * يجمّع ارتباطات الموظفات مرة واحدة، فالفحص باليوم بيمر على ارتباطاتها هي بس.
 *
 * @param attachments ارتباطات الشهر المقروءة
 * @returns ارتباطات كل موظفة
 */
function groupAttachmentsByEmployee(
  attachments: readonly CommissionEstimateAttachment[],
): ReadonlyMap<string, readonly CommissionEstimateAttachment[]> {
  const grouped = new Map<string, CommissionEstimateAttachment[]>();
  for (const attachment of attachments) {
    const bucket = grouped.get(attachment.employeeId);
    if (bucket === undefined) grouped.set(attachment.employeeId, [attachment]);
    else bucket.push(attachment);
  }
  return grouped;
}

/**
 * الموظفات المرشحات: كل موظفة عندها نشاط في الشهر — بند أو بيع أو بقشيش أو
 * تصحيح — وكل موظفة مرتبطة بفرع من نطاق القارئ في أي يوم من الشهر (CS-Q20).
 * الارتباط لوحده بيجعل الموظفة مرئية، فموظفة مرتبطة بلا عمل في الشهر بتظهر
 * بصفر حقيقي مش بتختفي، وصف راتب أو خطة أو تجاوز لوحده من غير نشاط أو ارتباط
 * ما بيزودش نتيجة.
 *
 * @param month صفوف الشهر المقروءة
 * @param attachmentsByEmployee ارتباطات مجمّعة
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param period الشهر بصيغة YYYY-MM
 * @returns معرّفات الموظفات المرشحات
 */
function candidateIds(
  month: CommissionEstimateMonthRows,
  attachmentsByEmployee: ReadonlyMap<string, readonly CommissionEstimateAttachment[]>,
  scope: ReadonlySet<string> | null,
  period: string,
): readonly string[] {
  const ids = new Set<string>();
  for (const line of month.lines) ids.add(line.employeeId);
  for (const sale of month.sales) {
    if (sale.sellerEmployeeId !== null) ids.add(sale.sellerEmployeeId);
  }
  for (const tip of month.tips) ids.add(tip.employeeId);
  for (const correction of month.corrections) ids.add(correction.employeeId);
  for (const [employeeId, attachments] of attachmentsByEmployee) {
    const relevant = attachments.some(
      (attachment) =>
        attachedDuring(attachment, period) && (scope === null || scope.has(attachment.branchId)),
    );
    if (relevant) ids.add(employeeId);
  }
  return [...ids].sort();
}

/**
 * يبني تقدير الشهر: تسعير كامل الشهر لكل موظفة مرشحة، ثم فلترة الصفوف بنطاق
 * الفروع، ثم جمع الأرقام المرئية بس. التسعير بيحصل قبل الفلترة، فمواضع الشرائح
 * ما بتتقادش لكل فرع (CS-Q24)، وفشل مصدر مخفي ما بيسقطش مصادر ظاهرة (CM-23).
 *
 * @param input النطاق والشهر والموظفات وصفوف الشهر وارتباطاتهن
 * @returns تقدير الشهر بالموظفات المرئيات ومجموعهن المرئي
 */
export function projectCommissionEstimate(
  input: CommissionEstimateProjectionInput,
): CommissionEstimateProjection {
  const allowed = input.scope.businessWide ? null : new Set(input.scope.branchIds);
  const names = new Set(input.employeeIds);
  const monthByEmployee = groupMonthByEmployee(input.month);
  const attachmentsByEmployee = groupAttachmentsByEmployee(input.attachments);
  const projections: CommissionEstimateEmployeeProjection[] = [];
  let total = 0n;
  let unpriced = false;
  for (const employeeId of candidateIds(
    input.month,
    attachmentsByEmployee,
    allowed,
    input.period,
  )) {
    if (!names.has(employeeId)) continue;
    const projection = projectEmployee(
      allowed,
      input.period,
      employeeId,
      monthByEmployee.get(employeeId) ?? emptyMonth(),
      attachmentsByEmployee.get(employeeId) ?? [],
    );
    if (projection === null) continue;
    projections.push(projection);
    if (projection.total === null) unpriced = true;
    else total += projection.total;
  }
  return {
    employees: projections,
    // القارئ على مستوى الفروع بيشوف مجموع جزئي من النشاط كله، فلازم يبقى
    // معلّم "جزئي" حتى لو كل موظفة ظاهرة ليه كاملة (CM-23g).
    partial: !input.scope.businessWide,
    total: unpriced ? null : total,
  };
}

/**
 * تقدير موظفة واحدة، أو null لما تكون خارج النطاق بالكامل.
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param period الشهر بصيغة YYYY-MM
 * @param employeeId الموظفة
 * @param month صفوف شهرها مجمّعة
 * @param attachments ارتباطاتها في الشهر
 * @returns إسقاط الموظفة أو null
 */
function projectEmployee(
  scope: ReadonlySet<string> | null,
  period: string,
  employeeId: string,
  month: EmployeeMonth,
  attachments: readonly CommissionEstimateAttachment[],
): CommissionEstimateEmployeeProjection | null {
  const assembled = assembleCommissionPeriodInput({
    employeeId,
    period,
    lines: month.lines,
    sales: month.sales,
    salaries: month.salaries,
    versions: month.versions,
    overrides: month.overrides,
    tips: month.tips,
    corrections: month.corrections,
  });
  const priced = computePeriodDetailed(assembled.input);
  const correctionVisible = assembled.corrections.some((correction) =>
    visibleTo(correction.attachedBranchIds, scope),
  );
  // تغطية أيام الشهر بتتحسب للقارئ على مستوى الفروع بس؛ القارئ على مستوى النشاط
  // بيشوف كل الأيام فما بيحتاجش الفحص (CM-23g).
  const covered = scope === null ? new Set<number>() : coveredDays(attachments, scope, period);
  if (scope !== null && !correctionVisible && covered.size === 0) return null;
  // تاريخ كل مصدر بيتفهرس مرة واحدة، ففشل التسعير ما بيمسحش المصفوفات كل مرة.
  const sourceDates = new Map<string, string>();
  for (const line of assembled.lines) sourceDates.set(`line:${line.lineId}`, line.businessDate);
  for (const sale of assembled.sales) sourceDates.set(`sale:${sale.saleId}`, sale.businessDate);
  const failure = visibleFailure(scope, attachments, sourceDates, priced);
  if (failure !== null) {
    const tips = collectTips(scope, attachments, assembled.tips);
    const corrections = collectCorrections(scope, assembled.corrections);
    return refusedMonth(employeeId, failure, tips, corrections);
  }
  const sources = collectSources(scope, attachments, assembled.lines, assembled.sales, priced);
  const tips = collectTips(scope, attachments, assembled.tips);
  const corrections = collectCorrections(scope, assembled.corrections);
  const outside = sources.outside || tips.outside || corrections.outside;
  return {
    employeeId,
    status: 'OK',
    partial: scope === null ? false : outside || covered.size < daysInMonth(period),
    total: sources.linesTotal + sources.salesTotal,
    sources: sources.sources,
    sales: sources.sales,
    tips: { card: tips.card, cash: tips.cash },
    corrections: corrections.corrections,
  };
}

/**
 * شهر موظفة ما تسعّرت عمولته: مصدر ظاهر ناقص خطة أو راتب، فالمجموع المجهول
 * بيفضل null من غير صرف أي عمولة جزئية (D-57)، والبقشاش والتصحيحات المعروفة
 * للقارئ بيفضلوا ظاهرين لأنهم بيعدّوا من غير تسعير (D-1).
 *
 * @param employeeId الموظفة
 * @param failure سبب منع التسعير
 * @param tips البقشيش المرئي للقارئ
 * @param tips.card مجموع بقشيش الكارت المرئي
 * @param tips.cash مجموع بقشيش الكاش المرئي
 * @param corrections التصحيحات المرئية للقارئ
 * @param corrections.corrections تصحيحات الشهر المرئية
 * @returns إسقاط الموظفة المرفوضة
 */
function refusedMonth(
  employeeId: string,
  failure: 'NO_PLAN' | 'NO_SALARY',
  tips: { readonly card: bigint; readonly cash: bigint },
  corrections: { readonly corrections: readonly CommissionEstimateCorrectionProjection[] },
): CommissionEstimateEmployeeProjection {
  return {
    employeeId,
    status: failure,
    partial: true,
    total: null,
    sources: [],
    sales: [],
    tips: { card: tips.card, cash: tips.cash },
    corrections: corrections.corrections,
  };
}

/**
 * أول فشل تسعير على مصدر ظاهر للقارئ. فشل مصدر مخفي ما بيظهرش في حالة
 * الموظفة عشان ما يفضحش سبب ما القارئ شايفهوش (CM-23)، والمصادر الظاهرة
 * بتضل مسعّرة بمجمّع الشهر كله.
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param attachments ارتباطات الموظفة
 * @param sourceDates تاريخ نشاط كل مصدر، مفهرس بمرجعه
 * @param priced نتيجة التسعير المفصّلة
 * @returns سبب المنع أو null
 */
function visibleFailure(
  scope: ReadonlySet<string> | null,
  attachments: readonly CommissionEstimateAttachment[],
  sourceDates: ReadonlyMap<string, string>,
  priced: CommissionPeriodDetailedResult,
): 'NO_PLAN' | 'NO_SALARY' | null {
  for (const failure of priced.failures) {
    const date = sourceDates.get(failure.sourceRef);
    if (date === undefined) continue;
    if (visibleTo(branchesOn(attachments, date), scope)) return failure.code;
  }
  return null;
}
