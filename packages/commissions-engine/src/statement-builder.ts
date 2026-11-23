import type { CommissionEstimateAttachment } from './estimate-projection-types.ts';
import { computePeriodDetailed } from './period-commission.ts';
import { assembleForLastDay, commissionPeriodLastDay } from './period-input-assembly.ts';
import { sortedBy } from './canonical-format.ts';
import type { RevisedSalary } from './canonical-input.ts';
import type { AssembledCommissionPeriod, IncomingCommissionCarry } from './period-input-types.ts';
import {
  groupAttachments,
  groupMonth,
  monthOfEmployee,
  type GroupedMonth,
} from './statement-grouping.ts';
import { lineRef, saleRef } from './statement-refs.ts';
import {
  carryRow,
  commissionRow,
  correctionRow,
  employeeRow,
  saleRow,
  tipRow,
  type EmployeeRowContext,
} from './statement-rows.ts';
import { assertUniqueAttachments, assertUniqueSources } from './statement-uniqueness.ts';
import type {
  StatementAttachmentRow,
  StatementBuild,
  StatementBuildInput,
  StatementCorrectionSource,
  StatementEmployeeLabel,
  StatementLineSource,
  StatementPricingFailure,
  StatementRow,
  StatementSaleSource,
  StatementTipSource,
} from './statement-types.ts';

/**
 * بطاقتان مختلفتان لنفس معرّف الموظفة في مدخل واحد: الباني بيرفض بدل ما يختار واحدة، لأن اللي
 * هيتجمّد اسمها ورقمها في كل صف، واختيار صامت يخلّي الكشف يتوقف على ترتيب القائمة.
 */
export class StatementCardConflictError extends RangeError {
  /**
   * يحفظ معرّف الموظفة اللي بطاقتها متضاربة، عشان المستدعي يعرف مين.
   *
   * @param employeeId معرّف الموظفة اللي ليها بطاقتان مختلفتان
   */
  constructor(readonly employeeId: string) {
    super('Statement employee cards conflict for the same employee id');
    this.name = 'StatementCardConflictError';
  }
}

/** مجمّعات الشهر اللي بيمر عليها كل موظفة بصفوفها هي بس. */
interface BuildScope {
  readonly period: string;
  readonly periodLastDay: string;
  readonly grouped: GroupedMonth;
  readonly frozenOf: ReadonlyMap<string, readonly StatementAttachmentRow[]>;
}

/** مصادر موظفة بعد الاختيار المشترك، بأنواع المصادر اللي الكشف بيحتاجها. */
type AssembledEmployee = AssembledCommissionPeriod<
  StatementLineSource,
  StatementSaleSource,
  RevisedSalary,
  StatementTipSource,
  StatementCorrectionSource,
  IncomingCommissionCarry
>;

/**
 * اليوم اللي قبل تاريخ YYYY-MM-DD؛ النهاية الحيّة نصف مفتوحة والمخزّنة آخر يوم داخل.
 *
 * @param isoDate التاريخ
 * @returns اليوم السابق بنفس الصيغة
 */
function previousDay(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** أول يوم وآخر يوم في الشهر بصيغة YYYY-MM-DD، بيتحسبوا مرة واحدة لكل بناء. */
interface MonthBounds {
  readonly first: string;
  readonly last: string;
}

/**
 * ارتباط حيّ بيتقص على الشهر: البداية مش قبل أول يوم، والنهاية آخر يوم داخل مش بعد آخر يوم.
 * ارتباط ما بيغطيش أي يوم (بعد الشهر، أو قبله، أو من نفس اليوم للنفس) بيطلع فيه آخر يوم قبل
 * أول يوم فيرجع null، فمفيش اختبار تقاطع منفصل.
 *
 * @param bounds أول يوم وآخر يوم في الشهر
 * @param attachment الارتباط الحيّ
 * @returns المرفق المقصوص أو null لما ما بيغطيش أي يوم
 */
function clipped(
  bounds: MonthBounds,
  attachment: CommissionEstimateAttachment,
): StatementAttachmentRow | null {
  const from = attachment.from < bounds.first ? bounds.first : attachment.from;
  const last = attachment.to === null ? bounds.last : previousDay(attachment.to);
  const to = last > bounds.last ? bounds.last : last;
  if (to < from) return null;
  return {
    employeeId: attachment.employeeId,
    branchId: attachment.branchId,
    attachedFrom: from,
    attachedTo: to,
  };
}

/**
 * ارتباطات الموظفات داخل النطاق بعد القص على الشهر؛ دي اللي بتتجمّد مع الكشف (FR-033).
 *
 * @param bounds أول يوم وآخر يوم في الشهر
 * @param labels الموظفات داخل النطاق
 * @param attachments الارتباطات الحيّة
 * @returns المرفقات مرتبة
 */
function frozenAttachments(
  bounds: MonthBounds,
  labels: ReadonlyMap<string, StatementEmployeeLabel>,
  attachments: readonly CommissionEstimateAttachment[],
): StatementAttachmentRow[] {
  const rows: StatementAttachmentRow[] = [];
  for (const attachment of attachments) {
    if (!labels.has(attachment.employeeId)) continue;
    const row = clipped(bounds, attachment);
    if (row !== null) rows.push(row);
  }
  return sortedBy(rows, (row) => [row.employeeId, row.branchId, row.attachedFrom]);
}

/**
 * بطاقات الموظفات بالمعرّف؛ بطاقة مكررة مطابقة بتتجمّع في واحدة، ومختلفة بترفض الباني.
 *
 * @param employees البطاقات كما جت في المدخل
 * @returns بطاقة واحدة لكل معرّف
 */
function cardsById(
  employees: readonly StatementEmployeeLabel[],
): Map<string, StatementEmployeeLabel> {
  const labels = new Map<string, StatementEmployeeLabel>();
  for (const label of employees) {
    const seen = labels.get(label.employeeId);
    if (seen === undefined) {
      labels.set(label.employeeId, label);
      continue;
    }
    const same =
      seen.employeeNumber === label.employeeNumber &&
      seen.nameAr === label.nameAr &&
      seen.nameEn === label.nameEn;
    if (!same) throw new StatementCardConflictError(label.employeeId);
  }
  return labels;
}

/**
 * كل موظفة ليها صف فعلي في الشهر لازم يبقى ليها بطاقة، وإلا الصف مش هيتجمّد (الاسم إجباري).
 *
 * @param scope مجمّعات الشهر
 * @param labels بطاقات الموظفات داخل النطاق
 */
function assertLabelled(
  scope: BuildScope,
  labels: ReadonlyMap<string, StatementEmployeeLabel>,
): void {
  const { grouped } = scope;
  const ids = new Set<string>();
  const buckets = [
    grouped.lines,
    grouped.sales,
    grouped.tips,
    grouped.corrections,
    grouped.carries,
  ];
  for (const bucket of buckets) {
    for (const employeeId of bucket.keys()) ids.add(employeeId);
  }
  for (const employeeId of ids) {
    if (labels.has(employeeId)) continue;
    const assembled = assembleEmployee(scope, employeeId);
    const has = assembled.lines.length + assembled.sales.length + assembled.tips.length;
    if (has + assembled.corrections.length + assembled.carries.length > 0) {
      throw new RangeError('Statement employee label is missing');
    }
  }
}

/**
 * اختيار مصادر موظفة واحدة من تجميع الشهر بالمجمّع المشترك.
 *
 * @param scope مجمّعات الشهر
 * @param employeeId الموظفة
 * @returns مصادرها ومدخل تسعيرها
 */
function assembleEmployee(scope: BuildScope, employeeId: string): AssembledEmployee {
  const rows = monthOfEmployee(scope.grouped, employeeId);
  return assembleForLastDay({ employeeId, period: scope.period, ...rows }, scope.periodLastDay);
}

/**
 * فروع الموظفة في الشهر لصف EMPLOYEE: فروع ارتباطاتها المقصوصة اللي هتتجمّد (ارتباط بيغطي يوم
 * واحد على الأقل من الشهر)، مع فروع تصحيحاتها المستلمة (FR-033).
 *
 * @param frozen مرفقاتها المقصوصة
 * @param corrections تصحيحاتها المستلمة
 * @returns معرّفات الفروع بلا تكرار
 */
function monthlyBranches(
  frozen: readonly StatementAttachmentRow[],
  corrections: readonly { readonly attachedBranchIds: readonly string[] }[],
): string[] {
  const months = frozen.map((attachment) => attachment.branchId);
  const corrected = corrections.flatMap((correction) => correction.attachedBranchIds);
  return [...new Set([...months, ...corrected])];
}

/**
 * صفوف موظفة واحدة وفشل تسعيرها، مجمّعة من نفس المجمّع المشترك والتسعير المفصّل.
 *
 * @param scope مجمّعات الشهر
 * @param ctx سياق الموظفة
 * @param assembled مصادرها بعد الاختيار المشترك
 * @returns صفوفها وفشل تسعيرها
 */
function employeeRows(
  scope: BuildScope,
  ctx: EmployeeRowContext,
  assembled: AssembledEmployee,
): { rows: StatementRow[]; failures: StatementPricingFailure[] } {
  const employeeId = ctx.label.employeeId;
  const priced = computePeriodDetailed(assembled.input);
  const rows: StatementRow[] = [];
  for (const line of assembled.lines) {
    const amount = priced.perSource.get(lineRef(line));
    if (amount !== undefined) rows.push(commissionRow(ctx, line, amount));
  }
  for (const sale of assembled.sales) {
    const amount = priced.perSource.get(saleRef(sale));
    if (amount !== undefined) rows.push(saleRow(ctx, sale, amount));
  }
  for (const tip of assembled.tips) rows.push(tipRow(ctx, tip));
  for (const correction of assembled.corrections) rows.push(correctionRow(ctx, correction));
  for (const carry of assembled.carries) rows.push(carryRow(ctx, carry));
  const branches = monthlyBranches(scope.frozenOf.get(employeeId) ?? [], assembled.corrections);
  rows.push(employeeRow(ctx.label, branches));
  const codes = [...new Set(priced.failures.map((failure) => failure.code))].sort();
  return { rows, failures: codes.map((code) => ({ employeeId, code })) };
}

/**
 * يبني صفوف الكشف اللي هتتجمّد عند الاعتماد، وارتباطاتها، وفشل التسعير (FR-026، D-6، D-26).
 * هو الباني الوحيد: المراجعة بتبصم اللي هيتجمّد، والتجميد بيدخل نفس الناتج، فمفيش نسخة تانية.
 *
 * - الشهر بيتتحقق منه مرة واحدة في الأول (`commissionPeriodLastDay`) حتى لو المدخل فاضي، وآخر
 *   يوم فيه هو اللي بيتمرر للمجمّع المشترك.
 * - الاختيار والتسعير بنفس المجمّع المشترك والمحرك: `assembleForLastDay` ثم
 *   `computePeriodDetailed`، وكل موظفة بتاخد صفوفها هي بس من تجميع الشهر مرة واحدة.
 *   مصدر فشل تسعيره (NO_PLAN أو NO_SALARY) ما بيطلعش له صف، وبيتسجّل في `failures` والمراجعة
 *   والاعتماد بيترفضوا (FR-027).
 * - بطاقة الموظفة بتتحدد بمعرّفها: بطاقة مكررة مطابقة بتنضم، ومختلفة بترمي
 *   `StatementCardConflictError`.
 * - مفتاح صف (الموظفة، مرجع المصدر) أو مرفق (الموظفة، الفرع، بداية الارتباط) متكرر في المدخل
 *   بيرمي `StatementDuplicateKeyError` قبل أي تسعير، لأن القاعدة هترفضه عند التجميد.
 * - لكل موظفة داخل النطاق صف EMPLOYEE بصفر، حتى من غير أي مصدر، وفروعه هي فروع المرفقات
 *   المقصوصة اللي بتتجمّد مع فروع تصحيحاتها.
 * - فروع كل مصدر (`attachedBranchIds`) من ارتباطات الموظفة في يوم عمله، بنصف مفتوح `[from, to)`.
 * - المرفقات بتتقص على الشهر والنهاية بتتخزن آخر يوم داخل.
 * - تصحيح مصدره بند (`line:<id>`) ملوش رأس إسقاط بيطلع من غير تفاصيل البند (null من غير اختراع).
 *   الحالة دي ممثَّلة في النموذج بس: جدول §6 وD-20 وR10 بيطلبوا تفاصيل البند متجمّدة، فقارئ
 *   PR 2 لازم يثبت هل الحالة دي ممكن توصله فعلًا ويبلّغ قبل ما يتحدد سلوك الفشل أو البديل.
 *
 * التزامان على المستدعي:
 * - `failures` لازم تبقى فاضية قبل أي تجميد. الباني بيرجّع الصفوف الجزئية جنب الفشل عن قصد،
 *   عشان العرض يقدر يوريها.
 * - التصحيحات الموقوفة المفتوحة مش مدخل هنا ومش بتظهر في `failures`: المراجعة والاعتماد بيفحصوها
 *   بنفسهم (FR-027، FR-048)، فشهر فشله الوحيد تصحيح موقوف بيرجع `failures` فاضية.
 *
 * @param input الشهر وصفوفه والموظفات داخل النطاق وارتباطاتهن والأسماء
 * @returns الصفوف والمرفقات وفشل التسعير لكل موظفة
 */
export function buildStatement(input: StatementBuildInput): StatementBuild {
  const periodLastDay = commissionPeriodLastDay(input.period);
  const labels = cardsById(input.employees);
  const bounds = { first: `${input.period}-01`, last: periodLastDay };
  const frozen = frozenAttachments(bounds, labels, input.attachments);
  assertUniqueAttachments(frozen);
  const scope: BuildScope = {
    period: input.period,
    periodLastDay,
    grouped: groupMonth(input.month),
    frozenOf: groupAttachments(frozen),
  };
  assertLabelled(scope, labels);
  const liveOf = groupAttachments(input.attachments);
  const prepared = sortedBy([...labels.values()], (card) => [card.employeeId]).map((label) => {
    const ctx: EmployeeRowContext = {
      label,
      attachments: liveOf.get(label.employeeId) ?? [],
      names: input.names,
      correctionLineDetails: input.correctionLineDetails,
    };
    const assembled = assembleEmployee(scope, label.employeeId);
    assertUniqueSources(label.employeeId, assembled);
    return { ctx, assembled };
  });
  const rows: StatementRow[] = [];
  const failures: StatementPricingFailure[] = [];
  for (const { ctx, assembled } of prepared) {
    const built = employeeRows(scope, ctx, assembled);
    for (const row of built.rows) rows.push(row);
    for (const failure of built.failures) failures.push(failure);
  }
  return { rows, attachments: frozen, failures };
}
