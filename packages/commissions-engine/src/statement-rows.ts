import { moneyToString } from '@pospay/domain';

import { parseCarryKind } from './carry-kind.ts';
import { branchesOn } from './estimate-visibility.ts';
import type { CommissionEstimateAttachment } from './estimate-projection-types.ts';
import type { ReceivedCommissionCorrection } from './period-input-types.ts';
import type {
  StatementCorrectionSource,
  StatementEmployeeLabel,
  StatementLineHead,
  StatementLineSource,
  StatementName,
  StatementNames,
  StatementRow,
  StatementRowKind,
  StatementSaleSource,
  StatementTipSource,
} from './statement-types.ts';
import type { IncomingCommissionCarry } from './period-input-types.ts';
import { carryRef, correctionRef, lineRef, saleRef, tipRef } from './statement-refs.ts';

/** سياق بناء صفوف موظفة واحدة: بطاقتها وارتباطاتها الحيّة والأسماء. */
export interface EmployeeRowContext {
  readonly label: StatementEmployeeLabel;
  readonly attachments: readonly CommissionEstimateAttachment[];
  readonly names: StatementNames;
  readonly correctionLineDetails: ReadonlyMap<string, StatementLineHead>;
}

/**
 * صف فاضي ببطاقة الموظفة، وكل الباقي null؛ كل نوع صف بيملا اللي يخصه.
 *
 * @param label بطاقة الموظفة
 * @param kind نوع الصف
 * @param sourceRef مرجع المصدر
 * @param amount المبلغ بالفلس
 * @returns الصف الفاضي
 */
function blank(
  label: StatementEmployeeLabel,
  kind: StatementRowKind,
  sourceRef: string,
  amount: bigint,
): StatementRow {
  return {
    employeeId: label.employeeId,
    employeeNumber: label.employeeNumber,
    employeeNameAr: label.nameAr,
    employeeNameEn: label.nameEn,
    sourceRef,
    kind,
    amount: moneyToString(amount),
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: null,
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    sourceBusinessDate: null,
    attachedBranchIds: [],
    lineId: null,
    sessionId: null,
    serviceId: null,
    serviceNameAr: null,
    serviceNameEn: null,
    customerId: null,
    customerName: null,
    businessDate: null,
  };
}

/**
 * اسم الفرع المجمّد: الاسم الإنجليزي إجباري (CHECK)، فغيابه خلل في القارئ مش حالة عمل.
 *
 * @param names الأسماء المقروءة
 * @param branchId الفرع
 * @returns اسم الفرع
 */
function branchName(names: StatementNames, branchId: string): StatementName {
  const name = names.branches.get(branchId);
  if (name === undefined) throw new RangeError('Statement branch name is missing');
  return name;
}

/**
 * أسماء بند للتجميد: اسم الخدمة الإنجليزي إجباري لأن الخدمة دايمًا ليها اسم، واسم العميل إجباري لما
 * `customerId` مش null، فغياب أي منهم من الخرائط خلل في القارئ مش حالة عمل (D-20)، زي غياب اسم الفرع.
 * الاسم العربي للخدمة اختياري، وبند من غير عميل ما ليهوش اسم.
 *
 * @param names الأسماء المقروءة
 * @param serviceId الخدمة
 * @param customerId العميل أو null
 * @returns اسم الخدمة واسم العميل (null لما مفيش عميل)
 */
function lineNames(
  names: StatementNames,
  serviceId: string,
  customerId: string | null,
): { service: StatementName; customerName: string | null } {
  const service = names.services.get(serviceId);
  if (service === undefined) throw new RangeError('Statement service name is missing');
  if (customerId === null) return { service, customerName: null };
  const customerName = names.customers.get(customerId);
  if (customerName === undefined) throw new RangeError('Statement customer name is missing');
  return { service, customerName };
}

/**
 * مكان المصدر: فرعه واسمه ويوم عمله وفروع الموظفة في اليوم ده.
 *
 * @param row الصف
 * @param ctx سياق الموظفة
 * @param branchId فرع العمل
 * @param businessDate يوم العمل
 * @param attached فروع الموظفة في يوم العمل
 * @returns الصف بمكانه
 */
function placed(
  row: StatementRow,
  ctx: EmployeeRowContext,
  branchId: string,
  businessDate: string,
  attached: readonly string[],
): StatementRow {
  const name = branchName(ctx.names, branchId);
  return {
    ...row,
    sourceBranchId: branchId,
    sourceBranchNameAr: name.nameAr,
    sourceBranchNameEn: name.nameEn,
    sourceBusinessDate: businessDate,
    attachedBranchIds: [...attached].sort(),
  };
}

/**
 * صف EMPLOYEE: صفر ما بيدخلش أي مجموع، وفروع الشهر مع فروع تصحيحاتها (FR-033).
 *
 * @param label بطاقة الموظفة
 * @param attachedBranchIds فروع الموظفة في الشهر وفروع تصحيحاتها
 * @returns الصف
 */
export function employeeRow(
  label: StatementEmployeeLabel,
  attachedBranchIds: readonly string[],
): StatementRow {
  return {
    ...blank(label, 'EMPLOYEE', `employee:${label.employeeId}`, 0n),
    attachedBranchIds: [...attachedBranchIds].sort(),
  };
}

/**
 * صف COMMISSION لبند: تفاصيل الزيارة والخدمة والعميل متجمّدة معاه (D-20).
 *
 * @param ctx سياق الموظفة
 * @param line البند
 * @param amount عمولة البند
 * @returns الصف
 */
export function commissionRow(
  ctx: EmployeeRowContext,
  line: StatementLineSource,
  amount: bigint,
): StatementRow {
  const base = blank(ctx.label, 'COMMISSION', lineRef(line), amount);
  const { service, customerName } = lineNames(ctx.names, line.serviceId, line.customerId);
  return {
    ...placed(
      base,
      ctx,
      line.branchId,
      line.businessDate,
      branchesOn(ctx.attachments, line.businessDate),
    ),
    lineId: line.lineId,
    sessionId: line.sessionId,
    serviceId: line.serviceId,
    serviceNameAr: service.nameAr,
    serviceNameEn: service.nameEn,
    customerId: line.customerId,
    customerName,
    businessDate: line.businessDate,
  };
}

/**
 * صف SALE لبيع باقة؛ مفيش تفاصيل زيارة.
 *
 * @param ctx سياق الموظفة
 * @param sale البيع
 * @param amount عمولة البيع
 * @returns الصف
 */
export function saleRow(
  ctx: EmployeeRowContext,
  sale: StatementSaleSource,
  amount: bigint,
): StatementRow {
  const base = blank(ctx.label, 'SALE', saleRef(sale), amount);
  return placed(
    base,
    ctx,
    sale.branchId,
    sale.businessDate,
    branchesOn(ctx.attachments, sale.businessDate),
  );
}

/**
 * صف بقشيش جلسة: tip:<session>:<method> ونوعه TIP_CARD أو TIP_CASH.
 *
 * @param ctx سياق الموظفة
 * @param tip صف البقشيش
 * @returns الصف
 */
export function tipRow(ctx: EmployeeRowContext, tip: StatementTipSource): StatementRow {
  const kind = tip.method === 'CARD' ? 'TIP_CARD' : 'TIP_CASH';
  const base = blank(ctx.label, kind, tipRef(tip), tip.amount);
  return placed(
    base,
    ctx,
    tip.branchId,
    tip.businessDate,
    branchesOn(ctx.attachments, tip.businessDate),
  );
}

const CORRECTION_KINDS: Record<ReceivedCommissionCorrection['kind'], StatementRowKind> = {
  COMMISSION: 'CORRECTION',
  SALE: 'CORRECTION',
  TIP_CARD: 'CORRECTION_TIP_CARD',
  TIP_CASH: 'CORRECTION_TIP_CASH',
};

/**
 * صف تصحيح مستلم: مصدره correction:<id> (معرّفه هو، لأن مرجع مصدره الأصلي بيتكرر مع كل جيل)،
 * والمبلغ هو الفرق، والفرع واليوم والفروع منسوخة من صف التصحيح نفسه. لو المصدر بند (line:<id>)،
 * الصف بياخد تفاصيل البند كلها زي صف COMMISSION: line_id وsession_id وservice_id وأسماء الخدمة
 * وcustomer_id واسم العميل وbusiness_date، من رأس إسقاط البند وأسماء الخدمة والعميل (جدول §6،
 * D-20، وقرار المدير التقني على بند التصحيح). التصحيح اللي مصدره بيع أو بقشيش ما بياخدش تفاصيل
 * بند. لو رأس البند مش موجود، التفاصيل بتفضل null ومش بتتخترع؛ والحالة دي ممثَّلة في النموذج بس:
 * جدول §6 وD-20 وR10 بيطلبوا تفاصيل البند متجمّدة، فقارئ PR 2 لازم يثبت هل الحالة دي ممكن توصله
 * فعلًا ويبلّغ قبل ما يتحدد سلوك الفشل أو البديل.
 *
 * @param ctx سياق الموظفة
 * @param correction التصحيح المستلم
 * @returns الصف
 */
export function correctionRow(
  ctx: EmployeeRowContext,
  correction: StatementCorrectionSource,
): StatementRow {
  const base = blank(
    ctx.label,
    CORRECTION_KINDS[correction.kind],
    correctionRef(correction),
    correction.amount,
  );
  const placedRow = placed(
    base,
    ctx,
    correction.sourceBranchId,
    correction.sourceBusinessDate,
    correction.attachedBranchIds,
  );
  const lineId = correction.sourceRef.startsWith('line:') ? correction.sourceRef.slice(5) : null;
  // TODO(spec): رأس البند ممكن يكون غايب؛ سلوك الفشل أو البديل بيتحدد بعد إثبات قارئ 51-1 PR 2
  const head = lineId === null ? undefined : ctx.correctionLineDetails.get(lineId);
  const detail = head === undefined ? null : lineNames(ctx.names, head.serviceId, head.customerId);
  return {
    ...placedRow,
    previousAmount: moneyToString(correction.previousAmount),
    newAmount: moneyToString(correction.newAmount),
    sourcePeriod: correction.sourcePeriod,
    lineId: head === undefined ? null : lineId,
    sessionId: head?.sessionId ?? null,
    serviceId: head?.serviceId ?? null,
    serviceNameAr: detail?.service.nameAr ?? null,
    serviceNameEn: detail?.service.nameEn ?? null,
    customerId: head?.customerId ?? null,
    customerName: detail?.customerName ?? null,
    businessDate: head?.businessDate ?? null,
  };
}

/**
 * صف مرحّل داخل: بلا فرع ولا يوم عمل ولا فروع مرتبطة؛ هو رصيد الموظفة كله (D-22).
 *
 * @param ctx سياق الموظفة
 * @param carry المرحّل الداخل
 * @returns الصف
 */
export function carryRow(ctx: EmployeeRowContext, carry: IncomingCommissionCarry): StatementRow {
  const kind = parseCarryKind(carry.kind) === 'COMMISSION' ? 'CARRY_COMMISSION' : 'CARRY_TIP_CARD';
  const base = blank(ctx.label, kind, carryRef(carry), carry.amount);
  return { ...base, sourcePeriod: carry.sourcePeriod };
}
