import { parseCarryKind } from './carry-kind.ts';
import type { CommissionPeriodDetailedResult } from './period-commission.ts';
import type { IncomingCommissionCarry } from './period-input-types.ts';
import type {
  CommissionEstimateAttachment,
  CommissionEstimateCorrection,
  CommissionEstimateCorrectionProjection,
  CommissionEstimateLine,
  CommissionEstimateSale,
  CommissionEstimateSaleProjection,
  CommissionEstimateSourceProjection,
  CommissionEstimateTip,
} from './estimate-projection-types.ts';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * عدد أيام الشهر.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @returns عدد أيام الشهر
 */
export function daysInMonth(period: string): number {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 2 && leap ? 29 : (MONTH_DAYS[month - 1] ?? 31);
}

/**
 * الفروع اللي كانت الموظفة مربوطة بيها في يوم العمل: البداية داخلة والنهاية
 * خارجة، وهي نفس قاعدة جدول الارتباطات الحيّة.
 *
 * @param attachments ارتباطات الموظفة
 * @param businessDate يوم العمل
 * @returns فروع الموظفة في اليوم ده
 */
export function branchesOn(
  attachments: readonly CommissionEstimateAttachment[],
  businessDate: string,
): readonly string[] {
  return attachments
    .filter(
      (attachment) =>
        attachment.from <= businessDate &&
        (attachment.to === null || businessDate < attachment.to),
    )
    .map((attachment) => attachment.branchId)
    .sort();
}

/**
 * القارئ على مستوى النشاط يشوف كل صف؛ غيره بيشوف الصف المرتبط بفرع من نطاقه بس.
 *
 * @param branches فروع المصدر في يومه
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @returns هل المصدر ظاهر للقارئ
 */
export function visibleTo(
  branches: readonly string[],
  scope: ReadonlySet<string> | null,
): boolean {
  if (scope === null) return true;
  return branches.some((id) => scope.has(id));
}

/**
 * هل الارتباط بيغطي أي يوم من الشهر؟ البداية داخلة والنهاية خارجة.
 *
 * @param attachment ارتباط الموظفة
 * @param period الشهر بصيغة YYYY-MM
 * @returns هل الارتباط بيغطي الشهر
 */
export function attachedDuring(
  attachment: CommissionEstimateAttachment,
  period: string,
): boolean {
  const periodStart = `${period}-01`;
  const periodEnd = `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
  if (attachment.from > periodEnd) return false;
  return attachment.to === null || attachment.to > periodStart;
}

/**
 * أيام الشهر اللي الموظفة كانت مربوطة بفرع من نطاق القارئ فيها (CS-Q23).
 * الارتباط نصف مفتوح `[from, to)` وبيتقصّ على الشهر: نهاية في شهر أو سنة
 * بعديّة بتغطي باقي الشهر، والنهاية الماضية والبداية المستقبلية ما بتغطوش
 * حاجة.
 *
 * @param attachments ارتباطات الموظفة
 * @param scope فروع القارئ
 * @param period الشهر بصيغة YYYY-MM
 * @returns الأيام المغطاة
 */
export function coveredDays(
  attachments: readonly CommissionEstimateAttachment[],
  scope: ReadonlySet<string>,
  period: string,
): ReadonlySet<number> {
  const days = new Set<number>();
  const total = daysInMonth(period);
  const monthStart = `${period}-01`;
  // المقارنة بآخر يوم جوه الشهر مش بأول الشهر اللي بعده، عشان ديسمبر 9999
  // ما يعدّيش لسنة بخمس أرقام ترتيبها النصي غلط.
  const monthLast = `${period}-${String(total).padStart(2, '0')}`;
  for (const attachment of attachments) {
    if (!scope.has(attachment.branchId)) continue;
    if (attachment.from > monthLast) continue;
    if (attachment.to !== null && attachment.to <= monthStart) continue;
    const firstDay = attachment.from <= monthStart ? 1 : Number(attachment.from.slice(8, 10));
    const lastDay =
      attachment.to !== null && attachment.to.startsWith(period)
        ? Number(attachment.to.slice(8, 10)) - 1
        : total;
    for (let day = firstDay; day <= lastDay; day += 1) days.add(day);
  }
  return days;
}

/**
 * المصادر المرئية للموظفة: بنودها وبيعاتها بمجاميعها. التسعير بيحصل على الشهر
 * كله والفلترة بتحصل بعده (CS-Q24).
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param attachments ارتباطات الموظفة
 * @param lines بنود الشهر
 * @param sales بيعات الشهر
 * @param priced نتيجة التسعير المفصّلة
 * @returns المصادر والمبيعات المرئية ومجاميعها
 */
export function collectSources(
  scope: ReadonlySet<string> | null,
  attachments: readonly CommissionEstimateAttachment[],
  lines: readonly CommissionEstimateLine[],
  sales: readonly CommissionEstimateSale[],
  priced: CommissionPeriodDetailedResult,
): {
  readonly sources: CommissionEstimateSourceProjection[];
  readonly sales: CommissionEstimateSaleProjection[];
  readonly linesTotal: bigint;
  readonly salesTotal: bigint;
  readonly outside: boolean;
} {
  const sources: CommissionEstimateSourceProjection[] = [];
  const visibleSales: CommissionEstimateSaleProjection[] = [];
  let linesTotal = 0n;
  let salesTotal = 0n;
  let outside = false;
  for (const line of lines) {
    if (!visibleTo(branchesOn(attachments, line.businessDate), scope)) {
      outside = true;
      continue;
    }
    const amount = priced.perSource.get(`line:${line.lineId}`);
    if (amount === undefined) continue;
    linesTotal += amount;
    sources.push({
      sourceRef: `line:${line.lineId}`,
      kind: 'COMMISSION',
      amount,
      branchId: line.branchId,
      businessDate: line.businessDate,
      serviceId: line.serviceId,
    });
  }
  for (const sale of sales) {
    if (!visibleTo(branchesOn(attachments, sale.businessDate), scope)) {
      outside = true;
      continue;
    }
    const amount = priced.perSource.get(`sale:${sale.saleId}`);
    if (amount === undefined) continue;
    salesTotal += amount;
    sources.push({
      sourceRef: `sale:${sale.saleId}`,
      kind: 'SALE',
      amount,
      branchId: sale.branchId,
      businessDate: sale.businessDate,
      serviceId: null,
    });
    visibleSales.push({
      saleId: sale.saleId,
      amount,
      branchId: sale.branchId,
      businessDate: sale.businessDate,
    });
  }
  return { sources, sales: visibleSales, linesTotal, salesTotal, outside };
}

/**
 * بقشيش الموظفة المرئي مقسوم بطريقة الدفع؛ البقشاش بيعدّي من غير تسعير (D-1).
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param attachments ارتباطات الموظفة
 * @param tips بقشيش الشهر
 * @returns مجموع الكارت والكاش وهل فيه بقشيش خارج النطاق
 */
export function collectTips(
  scope: ReadonlySet<string> | null,
  attachments: readonly CommissionEstimateAttachment[],
  tips: readonly CommissionEstimateTip[],
): { readonly card: bigint; readonly cash: bigint; readonly outside: boolean } {
  let card = 0n;
  let cash = 0n;
  let outside = false;
  for (const tip of tips) {
    if (!visibleTo(branchesOn(attachments, tip.businessDate), scope)) {
      outside = true;
      continue;
    }
    if (tip.method === 'CASH') cash += tip.amount;
    else card += tip.amount;
  }
  return { card, cash, outside };
}

/**
 * تصحيحات الموظفة المستلمة في الشهر: نسبتها المجمَّدة وفروعها المجمَّدة هما
 * اللي بيحددوا رؤيتها (FR-040)، والتصحيح من غير فروع مربوطة يتفادى لقارئ
 * الفروع.
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param corrections تصحيحات الشهر
 * @returns التصحيحات المرئية وهل فيه تصحيح خارج النطاق
 */
export function collectCorrections(
  scope: ReadonlySet<string> | null,
  corrections: readonly CommissionEstimateCorrection[],
): {
  readonly corrections: CommissionEstimateCorrectionProjection[];
  readonly outside: boolean;
} {
  const visible: CommissionEstimateCorrectionProjection[] = [];
  let outside = false;
  for (const correction of corrections) {
    if (!visibleTo(correction.attachedBranchIds, scope)) {
      outside = true;
      continue;
    }
    visible.push({
      sourceRef: correction.sourceRef,
      kind: correction.kind,
      amount: correction.amount,
      sourceBranchId: correction.sourceBranchId,
      sourceBusinessDate: correction.sourceBusinessDate,
    });
  }
  return { corrections: visible, outside };
}

/**
 * المرحّل الداخل المرئي للقارئ (D-22، BR-06): مجموع كل نوع لوحده، من غير تقاصّ بين العمولة
 * وبقشيش الكارت. المرحّل مالوش فرع، فالقارئ على مستوى الفروع ما بيشوفهوش خالص.
 *
 * @param scope فروع القارئ أو null لنطاق النشاط كله
 * @param carries المرحّلات الداخلة للموظفة في الشهر
 * @returns رصيد العمولة ورصيد بقشيش الكارت، أصفار للقارئ على مستوى الفروع. نوع غريب بيرمي للكل
 * حتى القارئ على مستوى الفروع، لأن صف مرحّل بنوع مش معروف خلل في البيانات مش حالة عمل.
 */
export function collectCarries(
  scope: ReadonlySet<string> | null,
  carries: readonly IncomingCommissionCarry[],
): { readonly commission: bigint; readonly tipCard: bigint } {
  let commission = 0n;
  let tipCard = 0n;
  for (const carry of carries) {
    const kind = parseCarryKind(carry.kind);
    if (scope !== null) continue;
    if (kind === 'COMMISSION') commission += carry.amount;
    else tipCard += carry.amount;
  }
  return { commission, tipCard };
}
