import { attachedDuring, daysInMonth } from './estimate-visibility.ts';
import type { CommissionEstimateAttachment } from './estimate-projection.ts';
import { computePeriodDetailed } from './period-commission.ts';
import { assembleCommissionPeriodInput } from './period-input-assembly.ts';
import { sortedBy } from './canonical-format.ts';
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
 * كل موظفة ليها صف فعلي في الشهر لازم يبقى ليها بطاقة، وإلا الصف مش هيتجمّد (الاسم إجباري).
 *
 * @param input مدخل البناء
 * @param labels بطاقات الموظفات داخل النطاق
 */
function assertLabelled(
  input: StatementBuildInput,
  labels: ReadonlyMap<string, StatementEmployeeLabel>,
): void {
  const { month, period } = input;
  const ids = new Set<string>();
  for (const line of month.lines) ids.add(line.employeeId);
  for (const sale of month.sales)
    if (sale.sellerEmployeeId !== null) ids.add(sale.sellerEmployeeId);
  for (const tip of month.tips) ids.add(tip.employeeId);
  for (const correction of month.corrections) ids.add(correction.employeeId);
  for (const carry of month.carries) ids.add(carry.employeeId);
  for (const employeeId of ids) {
    if (labels.has(employeeId)) continue;
    const assembled = assembleCommissionPeriodInput({ employeeId, period, ...month });
    const has = assembled.lines.length + assembled.sales.length + assembled.tips.length;
    if (has + assembled.corrections.length + assembled.carries.length > 0) {
      throw new RangeError('Statement employee label is missing');
    }
  }
}

/**
 * صفوف موظفة واحدة وفشل تسعيرها، مجمّعة من نفس المجمّع المشترك والتسعير المفصّل.
 *
 * @param input مدخل البناء
 * @param ctx سياق الموظفة
 * @returns صفوفها وفشل تسعيرها
 */
function employeeRows(
  input: StatementBuildInput,
  ctx: EmployeeRowContext,
): { rows: StatementRow[]; failures: StatementPricingFailure[] } {
  const employeeId = ctx.label.employeeId;
  const assembled = assembleCommissionPeriodInput({
    employeeId,
    period: input.period,
    ...input.month,
  });
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
  const months = ctx.attachments
    .filter((attachment) => attachedDuring(attachment, input.period))
    .map((attachment) => attachment.branchId);
  const corrected = assembled.corrections.flatMap((correction) => correction.attachedBranchIds);
  rows.push(employeeRow(ctx.label, [...new Set([...months, ...corrected])]));
  const codes = [...new Set(priced.failures.map((failure) => failure.code))].sort();
  return { rows, failures: codes.map((code) => ({ employeeId, code })) };
}

/**
 * يبني صفوف الكشف اللي هتتجمّد عند الاعتماد، وارتباطاتها، وفشل التسعير (FR-026، D-6، D-26).
 * هو الباني الوحيد: المراجعة بتبصم اللي هيتجمّد، والتجميد بيدخل نفس الناتج، فمفيش نسخة تانية.
 *
 * - الاختيار والتسعير بنفس المجمّع المشترك والمحرك: `assembleCommissionPeriodInput` ثم
 *   `computePeriodDetailed`. مصدر فشل تسعيره (NO_PLAN أو NO_SALARY) ما بيطلعش له صف،
 *   وبيتسجّل في `failures` والمراجعة والاعتماد بيترفضوا (FR-027).
 * - لكل موظفة داخل النطاق صف EMPLOYEE بصفر، حتى من غير أي مصدر.
 * - فروع كل مصدر (`attachedBranchIds`) من ارتباطات الموظفة في يوم عمله، بنصف مفتوح `[from, to)`.
 * - المرفقات بتتقص على الشهر والنهاية بتتخزن آخر يوم داخل.
 *
 * @param input الشهر وصفوفه والموظفات داخل النطاق وارتباطاتهن والأسماء
 * @returns الصفوف والمرفقات وفشل التسعير لكل موظفة
 */
export function buildStatement(input: StatementBuildInput): StatementBuild {
  const labels = new Map(input.employees.map((label) => [label.employeeId, label]));
  assertLabelled(input, labels);
  const attachmentsOf = new Map<string, CommissionEstimateAttachment[]>();
  for (const attachment of input.attachments) {
    const bucket = attachmentsOf.get(attachment.employeeId);
    if (bucket === undefined) attachmentsOf.set(attachment.employeeId, [attachment]);
    else bucket.push(attachment);
  }
  const rows: StatementRow[] = [];
  const failures: StatementPricingFailure[] = [];
  for (const label of sortedBy(input.employees, (employee) => [employee.employeeId])) {
    const ctx: EmployeeRowContext = {
      label,
      attachments: attachmentsOf.get(label.employeeId) ?? [],
      names: input.names,
      correctionLineDetails: input.correctionLineDetails,
    };
    const built = employeeRows(input, ctx);
    rows.push(...built.rows);
    failures.push(...built.failures);
  }
  return {
    rows,
    attachments: frozenAttachments(input.period, labels, input.attachments),
    failures,
  };
}
