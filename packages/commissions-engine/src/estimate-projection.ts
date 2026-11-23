import type { ServiceCommissionOverride } from './commission-types.ts';
import {
  attachedDuring,
  branchesOn,
  collectCarries,
  collectCorrections,
  collectSources,
  collectTips,
  coveredDays,
  daysInMonth,
  visibleTo,
} from './estimate-visibility.ts';
import type {
  CommissionEstimateAttachment,
  CommissionEstimateCorrection,
  CommissionEstimateCorrectionProjection,
  CommissionEstimateEmployeeProjection,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateProjection,
  CommissionEstimateProjectionInput,
  CommissionEstimateSale,
  CommissionEstimateTip,
} from './estimate-projection-types.ts';
import { assembleCommissionPeriodInput, countsInPeriod } from './period-input-assembly.ts';
import { computePeriodDetailed, type CommissionPeriodDetailedResult } from './period-commission.ts';
import type { IncomingCommissionCarry } from './period-input-types.ts';
import type { CommissionPlanVersion, CommissionSalary } from './plan-types.ts';

/** صفوف شهر موظفة واحدة مجمّعة مرة واحدة، بدل ما كل موظفة تفلتر على المصفوفة كلها. */
interface EmployeeMonth {
  lines: CommissionEstimateLine[];
  sales: CommissionEstimateSale[];
  tips: CommissionEstimateTip[];
  corrections: CommissionEstimateCorrection[];
  carries: IncomingCommissionCarry[];
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
    carries: [],
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
  for (const correction of month.corrections)
    of(correction.employeeId).corrections.push(correction);
  for (const carry of month.carries ?? []) of(carry.employeeId).carries.push(carry);
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
 * الموظفات المرشحات: كل موظفة عندها نشاط في الشهر — بند أو بيع ساري أو بقشيش أو
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
  // نفس شرط المجمّع المشترك: البند أو البيع الملغي أو اللي بره الشهر ما بيتسعّرش،
  // فما ينفعش يخلّي صاحبته مرشحة بصفر.
  for (const line of month.lines) {
    if (countsInPeriod(line, period)) ids.add(line.employeeId);
  }
  for (const sale of month.sales) {
    if (sale.sellerEmployeeId === null) continue;
    if (countsInPeriod(sale, period)) ids.add(sale.sellerEmployeeId);
  }
  for (const tip of month.tips) ids.add(tip.employeeId);
  for (const correction of month.corrections) ids.add(correction.employeeId);
  // المرحّل مالوش فرع (D-22): بيخلّي الموظفة مرشحة للقارئ على مستوى النشاط بس.
  if (scope === null) {
    for (const carry of month.carries ?? []) {
      if (carry.targetPeriod === period) ids.add(carry.employeeId);
    }
  }
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
    carries: month.carries,
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
  const sources = collectSources(scope, attachments, assembled.lines, assembled.sales, priced);
  const tips = collectTips(scope, attachments, assembled.tips);
  const corrections = collectCorrections(scope, assembled.corrections);
  const carries = collectCarries(scope, assembled.carries);
  // المرحّل مالوش فرع، فأي مرحّل داخل بيخلّي أرقام القارئ على مستوى الفروع جزئية (D-22).
  const outside =
    sources.outside || tips.outside || corrections.outside || assembled.carries.length > 0;
  // "جزئي" بتوصف النطاق بس: صف بره فروع القارئ أو تغطية أيام ناقصة. رفض
  // التسعير بيتقال بالحالة وبالمجموع null، مش بالعلامة دي.
  const partial = scope === null ? false : outside || covered.size < daysInMonth(period);
  if (failure !== null) {
    return refusedMonth(employeeId, failure, partial, { tips, corrections, carries });
  }
  return {
    employeeId,
    status: 'OK',
    partial,
    total: sources.linesTotal + sources.salesTotal,
    sources: sources.sources,
    sales: sources.sales,
    tips: { card: tips.card, cash: tips.cash },
    corrections: corrections.corrections,
    carries,
  };
}

/**
 * شهر موظفة ما تسعّرت عمولته: مصدر ظاهر ناقص خطة أو راتب، فالمجموع المجهول
 * بيفضل null من غير صرف أي عمولة جزئية (D-57)، والبقشاش والتصحيحات المعروفة
 * للقارئ بيفضلوا ظاهرين لأنهم بيعدّوا من غير تسعير (D-1).
 *
 * @param employeeId الموظفة
 * @param failure سبب منع التسعير
 * @param partial أرقامها جزئية: صف بره نطاق القارئ أو تغطية أيام ناقصة
 * @param passthrough الأقسام اللي بتعدّي من غير تسعير
 * @param passthrough.tips البقشيش المرئي للقارئ
 * @param passthrough.tips.card مجموع بقشيش الكارت المرئي
 * @param passthrough.tips.cash مجموع بقشيش الكاش المرئي
 * @param passthrough.corrections التصحيحات المرئية للقارئ
 * @param passthrough.corrections.corrections تصحيحات الشهر المرئية
 * @param passthrough.carries المرحّل الداخل المرئي للقارئ
 * @returns إسقاط الموظفة المرفوضة
 */
function refusedMonth(
  employeeId: string,
  failure: 'NO_PLAN' | 'NO_SALARY',
  partial: boolean,
  passthrough: {
    readonly tips: { readonly card: bigint; readonly cash: bigint };
    readonly corrections: {
      readonly corrections: readonly CommissionEstimateCorrectionProjection[];
    };
    readonly carries: CommissionEstimateEmployeeProjection['carries'];
  },
): CommissionEstimateEmployeeProjection {
  return {
    employeeId,
    status: failure,
    partial,
    total: null,
    sources: [],
    sales: [],
    tips: { card: passthrough.tips.card, cash: passthrough.tips.cash },
    corrections: passthrough.corrections.corrections,
    carries: passthrough.carries,
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
