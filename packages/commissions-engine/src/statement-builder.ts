import { attachedDuring, daysInMonth } from './estimate-visibility.ts';
import type { CommissionEstimateAttachment } from './estimate-projection.ts';
import { computePeriodDetailed } from './period-commission.ts';
import { assembleForLastDay, commissionPeriodLastDay } from './period-input-assembly.ts';
import { sortedBy } from './canonical-format.ts';
import {
  groupAttachments,
  groupMonth,
  monthOfEmployee,
  type GroupedMonth,
} from './statement-grouping.ts';
import {
  carryRow,
  commissionRow,
  correctionRow,
  employeeRow,
  saleRow,
  tipRow,
  type EmployeeRowContext,
} from './statement-rows.ts';
import type {
  StatementAttachmentRow,
  StatementBuild,
  StatementBuildInput,
  StatementEmployeeLabel,
  StatementPricingFailure,
  StatementRow,
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

/**
 * ارتباط حيّ بيتقص على الشهر: البداية مش قبل أول يوم، والنهاية آخر يوم داخل مش بعد آخر يوم.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @param attachment الارتباط الحيّ
 * @returns المرفق المقصوص أو null لما ما بيغطيش أي يوم
 */
function clipped(
  period: string,
  attachment: CommissionEstimateAttachment,
): StatementAttachmentRow | null {
  if (!attachedDuring(attachment, period)) return null;
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
  const from = attachment.from < monthStart ? monthStart : attachment.from;
  const last = attachment.to === null ? monthEnd : previousDay(attachment.to);
  const to = last > monthEnd ? monthEnd : last;
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
 * @param period الشهر بصيغة YYYY-MM
 * @param labels الموظفات داخل النطاق
 * @param attachments الارتباطات الحيّة
 * @returns المرفقات مرتبة
 */
function frozenAttachments(
  period: string,
  labels: ReadonlyMap<string, StatementEmployeeLabel>,
  attachments: readonly CommissionEstimateAttachment[],
): StatementAttachmentRow[] {
  const rows: StatementAttachmentRow[] = [];
  for (const attachment of attachments) {
    if (!labels.has(attachment.employeeId)) continue;
    const row = clipped(period, attachment);
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
  const { grouped, period, periodLastDay } = scope;
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
    const rows = monthOfEmployee(grouped, employeeId);
    const assembled = assembleForLastDay({ employeeId, period, ...rows }, periodLastDay);
    const has = assembled.lines.length + assembled.sales.length + assembled.tips.length;
    if (has + assembled.corrections.length + assembled.carries.length > 0) {
      throw new RangeError('Statement employee label is missing');
    }
  }
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
 * @returns صفوفها وفشل تسعيرها
 */
function employeeRows(
  scope: BuildScope,
  ctx: EmployeeRowContext,
): { rows: StatementRow[]; failures: StatementPricingFailure[] } {
  const employeeId = ctx.label.employeeId;
  const assembled = assembleForLastDay(
    { employeeId, period: scope.period, ...monthOfEmployee(scope.grouped, employeeId) },
    scope.periodLastDay,
  );
  const priced = computePeriodDetailed(assembled.input);
  const rows: StatementRow[] = [];
  for (const line of assembled.lines) {
    const amount = priced.perSource.get(`line:${line.lineId}`);
    if (amount !== undefined) rows.push(commissionRow(ctx, line, amount));
  }
  for (const sale of assembled.sales) {
    const amount = priced.perSource.get(`sale:${sale.saleId}`);
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
 * - لكل موظفة داخل النطاق صف EMPLOYEE بصفر، حتى من غير أي مصدر، وفروعه هي فروع المرفقات
 *   المقصوصة اللي بتتجمّد مع فروع تصحيحاتها.
 * - فروع كل مصدر (`attachedBranchIds`) من ارتباطات الموظفة في يوم عمله، بنصف مفتوح `[from, to)`.
 * - المرفقات بتتقص على الشهر والنهاية بتتخزن آخر يوم داخل.
 * - تصحيح مصدره بند (`line:<id>`) ملوش رأس إسقاط بيطلع من غير تفاصيل البند (null من غير اختراع).
 *   الحالة دي ممثَّلة في النموذج بس: جدول §6 وD-20 وR10 بيطلبوا تفاصيل البند متجمّدة، فقارئ
 *   PR 2 لازم يثبت هل الحالة دي ممكن توصله فعلًا ويبلّغ قبل ما يتحدد سلوك الفشل أو البديل.
 *
 * @param input الشهر وصفوفه والموظفات داخل النطاق وارتباطاتهن والأسماء
 * @returns الصفوف والمرفقات وفشل التسعير لكل موظفة
 */
export function buildStatement(input: StatementBuildInput): StatementBuild {
  const periodLastDay = commissionPeriodLastDay(input.period);
  const labels = cardsById(input.employees);
  const frozen = frozenAttachments(input.period, labels, input.attachments);
  const scope: BuildScope = {
    period: input.period,
    periodLastDay,
    grouped: groupMonth(input.month),
    frozenOf: groupAttachments(frozen),
  };
  assertLabelled(scope, labels);
  const liveOf = groupAttachments(input.attachments);
  const rows: StatementRow[] = [];
  const failures: StatementPricingFailure[] = [];
  for (const label of sortedBy([...labels.values()], (card) => [card.employeeId])) {
    const ctx: EmployeeRowContext = {
      label,
      attachments: liveOf.get(label.employeeId) ?? [],
      names: input.names,
      correctionLineDetails: input.correctionLineDetails,
    };
    const built = employeeRows(scope, ctx);
    rows.push(...built.rows);
    failures.push(...built.failures);
  }
  return { rows, attachments: frozen, failures };
}
