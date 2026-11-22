import type {
  CommissionEstimate,
  CommissionEstimateCorrection,
  CommissionEstimateEmployee,
  CommissionEstimateSale,
  CommissionEstimateSource,
} from '@pospay/contracts';
import { assembleCommissionPeriodInput, computePeriod } from '@pospay/commissions-engine';
import { moneyToString } from '@pospay/domain';

import type {
  CommissionEstimateAttachment,
  CommissionEstimateMonthRows,
  CommissionEstimateReadResult,
} from '../../ports/commission-estimate.port.ts';

/** طلب تقدير شهر واحد لموظفة واحدة أو للنشاط كله. */
export interface CommissionEstimateRequest {
  /** الشركة المؤكدة من الجلسة، مش من العميل. */
  readonly companyId: string;
  /** المستخدم البشري الفاعل، من الجلسة. */
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
  readonly employeeId: string | null;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(period: string): number {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 && leap ? 29 : MONTH_DAYS[month - 1] ?? 31;
}

/**
 * الفروع التي كانت الموظفة مربوطة بيها في يوم العمل: البداية داخلة والنهاية
 * خارجة، وهي نفس قاعدة جدول الارتباطات الحيّة. الصف مالوش ارتباط بيطلع بنسخة
 * فاضية، والقارئ على مستوى الفروع ما بيشوفش صف بنسخة فاضية أبداً.
 */
function branchesOn(
  attachments: readonly CommissionEstimateAttachment[],
  employeeId: string,
  businessDate: string,
): readonly string[] {
  return attachments
    .filter(
      (attachment) =>
        attachment.employeeId === employeeId &&
        attachment.from <= businessDate &&
        (attachment.to === null || businessDate < attachment.to),
    )
    .map((attachment) => attachment.branchId)
    .sort();
}

function overlaps(candidates: readonly string[], scope: ReadonlySet<string>): boolean {
  return candidates.some((id) => scope.has(id));
}

/**
 * يبني تقدير الشهر من مدخلات القراءة الواحدة (FR-021): تسعير كامل الشهر لكل
 * موظفة مرشحة، ثم فلترة الصفوف بنطاق الفروع، ثم جمع الأرقام المرئية بس.
 * التسعير بيحصل قبل الفلترة، فمواضع الشرائح ما بتتقادش لكل فرع (CS-Q24)،
 * والقارئ على مستوى الفروع بيشوف مجموع الجزء بس والصف بيتلوّن "جزئي".
 *
 * @param inputs مدخلات القراءة الواحدة
 * @param request طلب التقدير
 * @returns تقدير الشهر بالموظفات المرئيات
 */
export function buildCommissionEstimate(
  inputs: CommissionEstimateReadResult,
  request: CommissionEstimateRequest,
): CommissionEstimate {
  const scope = inputs.businessWide ? null : new Set(inputs.branchIds);
  const employees: CommissionEstimateEmployee[] = [];
  let total = 0n;
  for (const employeeId of candidateEmployees(inputs.month)) {
    if (request.employeeId !== null && employeeId !== request.employeeId) continue;
    const entry = estimateEmployee(inputs, scope, employeeId, request);
    if (entry === null) continue;
    employees.push(entry.employee);
    total += entry.total;
  }
  return {
    business_id: request.businessId,
    period: request.period,
    employees,
    partial: employees.some((employee) => employee.partial),
    total: moneyToString(total),
  };
}

/** تقدير موظفة واحدة مع المجموع المرئي، أو null لما تكون خارج النطاق. */
interface EmployeeEstimate {
  readonly employee: CommissionEstimateEmployee;
  readonly total: bigint;
}

function estimateEmployee(
  inputs: CommissionEstimateReadResult,
  scope: ReadonlySet<string> | null,
  employeeId: string,
  request: CommissionEstimateRequest,
): EmployeeEstimate | null {
  const correctionVisible = inputs.month.corrections.some(
    (correction) => correction.employeeId === employeeId && visible(correction.attachedBranchIds, scope),
  );
  const attachedDays = coveredDays(inputs.attachments, employeeId, scope, request.period);
  if (!inputs.businessWide && !correctionVisible && attachedDays.size === 0) return null;
  const priced = priceEmployee(inputs.month, employeeId, request.period);
  const rows = visibleRows(inputs, scope, employeeId, priced);
  const name = inputs.employees.find((employee) => employee.employeeId === employeeId);
  // موظفة بلا صف موظفين في النشاط ده مالهاش اسم يتعرض، فتتشال من الرد بدل ما يتعرض
  // اسم فاضي: الرد ما بيقدرش يكشف موظفة من نشاط تاني.
  if (name === undefined) return null;
  const partial =
    inputs.businessWide ? false : rows.outside || attachedDays.size < daysInMonth(request.period);
  const employee: CommissionEstimateEmployee = {
    employee_id: employeeId,
    name_ar: name.nameAr,
    name_en: name.nameEn,
    employee_number: name.employeeNumber,
    status: priced.status,
    partial,
    total: moneyToString(rows.total),
    sources: rows.sources,
    sales: rows.sales,
    tips: { card: moneyToString(rows.card), cash: moneyToString(rows.cash) },
    corrections: rows.corrections,
  };
  return { employee, total: rows.total };
}

/** الصفوف المرئية للموظفة: التسعير بيحصل على الشهر كله والفلترة بتحصل بعده. */
interface VisibleRows {
  readonly sources: CommissionEstimateSource[];
  readonly sales: CommissionEstimateSale[];
  readonly corrections: CommissionEstimateCorrection[];
  readonly card: bigint;
  readonly cash: bigint;
  readonly total: bigint;
  /** صف من شهرها خارج نطاق القارئ، فالأرقام جزئية. */
  readonly outside: boolean;
}

function visibleRows(
  inputs: CommissionEstimateReadResult,
  scope: ReadonlySet<string> | null,
  employeeId: string,
  priced: PricedEmployee,
): VisibleRows {
  const lines = visibleLines(inputs, scope, employeeId, priced);
  const sales = visibleSales(inputs, scope, employeeId, priced);
  const tips = visibleTips(inputs, scope, employeeId, priced);
  const corrections = visibleCorrections(scope, priced);
  return {
    sources: [...lines.sources, ...sales.sources],
    sales: sales.sales,
    corrections: corrections.corrections,
    card: tips.card,
    cash: tips.cash,
    total: lines.total + sales.total,
    outside: lines.outside || sales.outside || tips.outside || corrections.outside,
  };
}

function visibleLines(
  inputs: CommissionEstimateReadResult,
  scope: ReadonlySet<string> | null,
  employeeId: string,
  priced: PricedEmployee,
): { readonly sources: CommissionEstimateSource[]; readonly total: bigint; readonly outside: boolean } {
  const sources: CommissionEstimateSource[] = [];
  let total = 0n;
  let outside = false;
  for (const line of priced.lines) {
    if (!visible(branchesOn(inputs.attachments, employeeId, line.businessDate), scope)) {
      outside = true;
      continue;
    }
    const amount = priced.perSource.get(`line:${line.lineId}`);
    if (amount === undefined) continue;
    total += amount;
    sources.push({
      source_ref: `line:${line.lineId}`,
      kind: 'COMMISSION',
      amount: moneyToString(amount),
      source_branch_id: line.branchId,
      source_business_date: line.businessDate,
    });
  }
  return { sources, total, outside };
}

function visibleSales(
  inputs: CommissionEstimateReadResult,
  scope: ReadonlySet<string> | null,
  employeeId: string,
  priced: PricedEmployee,
): {
  readonly sources: CommissionEstimateSource[];
  readonly sales: CommissionEstimateSale[];
  readonly total: bigint;
  readonly outside: boolean;
} {
  const sources: CommissionEstimateSource[] = [];
  const sales: CommissionEstimateSale[] = [];
  let total = 0n;
  let outside = false;
  for (const sale of priced.sales) {
    if (!visible(branchesOn(inputs.attachments, employeeId, sale.businessDate), scope)) {
      outside = true;
      continue;
    }
    const amount = priced.perSource.get(`sale:${sale.saleId}`);
    if (amount === undefined) continue;
    total += amount;
    sources.push({
      source_ref: `sale:${sale.saleId}`,
      kind: 'SALE',
      amount: moneyToString(amount),
      source_branch_id: sale.branchId,
      source_business_date: sale.businessDate,
    });
    sales.push({
      sale_id: sale.saleId,
      amount: moneyToString(amount),
      source_branch_id: sale.branchId,
      source_business_date: sale.businessDate,
    });
  }
  return { sources, sales, total, outside };
}

function visibleTips(
  inputs: CommissionEstimateReadResult,
  scope: ReadonlySet<string> | null,
  employeeId: string,
  priced: PricedEmployee,
): { readonly card: bigint; readonly cash: bigint; readonly outside: boolean } {
  let card = 0n;
  let cash = 0n;
  let outside = false;
  for (const tip of priced.tips) {
    if (!visible(branchesOn(inputs.attachments, employeeId, tip.businessDate), scope)) {
      outside = true;
      continue;
    }
    if (tip.method === 'CASH') cash += tip.amount;
    else card += tip.amount;
  }
  return { card, cash, outside };
}

function visibleCorrections(
  scope: ReadonlySet<string> | null,
  priced: PricedEmployee,
): { readonly corrections: CommissionEstimateCorrection[]; readonly outside: boolean } {
  const corrections: CommissionEstimateCorrection[] = [];
  let outside = false;
  for (const correction of priced.corrections) {
    if (!visible(correction.attachedBranchIds, scope)) {
      outside = true;
      continue;
    }
    corrections.push({
      source_ref: correction.sourceRef,
      kind: correction.kind,
      amount: moneyToString(correction.amount),
      source_branch_id: correction.sourceBranchId,
      source_business_date: correction.sourceBusinessDate,
    });
  }
  return { corrections, outside };
}

/** القارئ على مستوى النشاط يشوف كل صف؛ غيره بيشوف الصف المرتبط بفرع من نطاقه بس. */
function visible(branches: readonly string[], scope: ReadonlySet<string> | null): boolean {
  if (scope === null) return true;
  return overlaps(branches, scope);
}

/**
 * الموظفات المرشحات: كل موظفة عندها مدخل في الشهر أو استلمت تصحيحاً فيه،
 * والموظفة المنتهية بتبقى مرشحة لو استلمت تصحيحاً (CM-23c).
 */
function candidateEmployees(month: CommissionEstimateMonthRows): readonly string[] {
  const ids = new Set<string>();
  for (const line of month.lines) ids.add(line.employeeId);
  for (const sale of month.sales) if (sale.sellerEmployeeId !== null) ids.add(sale.sellerEmployeeId);
  for (const tip of month.tips) ids.add(tip.employeeId);
  for (const correction of month.corrections) ids.add(correction.employeeId);
  return [...ids].sort();
}

/**
 * الأيام اللي الموظفة كانت مربوطة بفرع من نطاق القارئ فيها، وهي أساس وسم
 * "جزئي": التغطية الجزئية بتخفي جزء من شهرها (CS-Q23 = PP-21.2).
 */
function coveredDays(
  attachments: readonly CommissionEstimateAttachment[],
  employeeId: string,
  scope: ReadonlySet<string> | null,
  period: string,
): Set<number> {
  const days = new Set<number>();
  const total = daysInMonth(period);
  for (let day = 1; day <= total; day += 1) {
    const date = `${period}-${String(day).padStart(2, '0')}`;
    const branches = branchesOn(attachments, employeeId, date);
    if (scope === null) {
      if (branches.length > 0) days.add(day);
      continue;
    }
    if (overlaps(branches, scope)) days.add(day);
  }
  return days;
}

interface PricedEmployee {
  readonly lines: CommissionEstimateMonthRows['lines'];
  readonly sales: CommissionEstimateMonthRows['sales'];
  readonly tips: CommissionEstimateMonthRows['tips'];
  readonly corrections: CommissionEstimateMonthRows['corrections'];
  readonly perSource: ReadonlyMap<string, bigint>;
  readonly status: CommissionEstimateEmployee['status'];
}

/**
 * بيسعّر شهر الموظفة بمحرك العمولة مرة واحدة للفترة كلها، فمواضع الشرائح
 * بتتقاس على الشهر مش على الجزء المرئي (CS-Q24). بند ملغى أو بيع مش قائم
 * ما بيوصلش للتسعير، والشهر ناقص الإعداد بيرجع حالته بدل نتيجة جزئية.
 */
function priceEmployee(
  month: CommissionEstimateMonthRows,
  employeeId: string,
  period: string,
): PricedEmployee {
  const lines = month.lines.filter((line) => line.employeeId === employeeId);
  const sales = month.sales.filter((sale) => sale.sellerEmployeeId === employeeId);
  const tips = month.tips.filter((tip) => tip.employeeId === employeeId);
  const corrections = month.corrections.filter(
    (correction) => correction.employeeId === employeeId,
  );
  const assembled = assembleCommissionPeriodInput({
    employeeId,
    period,
    lines,
    sales,
    salaries: month.salaries.filter((salary) => salary.employeeId === employeeId),
    versions: month.versions.filter((version) => version.employeeId === employeeId),
    overrides: month.overrides.filter((override) => override.employeeId === employeeId),
    tips,
    corrections,
  });
  const computed = computePeriod(assembled.input);
  if (!computed.ok) {
    // الشهر ناقص الإعداد بيرجع حالته بدل نتيجة جزئية، والصفوف الملغاة ما بتتسعرش
    // وما بتتحسبش من شهر الموظفة.
    return {
      lines: assembled.lines,
      sales: assembled.sales,
      tips: assembled.tips,
      corrections: assembled.corrections,
      perSource: new Map(),
      status: computed.code,
    };
  }
  return {
    lines: assembled.lines,
    sales: assembled.sales,
    tips: assembled.tips,
    corrections: assembled.corrections,
    perSource: computed.perSource,
    status: 'OK',
  };
}
