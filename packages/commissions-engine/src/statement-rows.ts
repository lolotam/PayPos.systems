import { moneyToString } from '@pospay/domain';

import { branchesOn } from './estimate-visibility.ts';
import type { CommissionEstimateAttachment } from './estimate-projection.ts';
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
  const base = blank(ctx.label, 'COMMISSION', `line:${line.lineId}`, amount);
  const service = ctx.names.services.get(line.serviceId);
  const customer = line.customerId === null ? null : ctx.names.customers.get(line.customerId);
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
    serviceNameAr: service?.nameAr ?? null,
    serviceNameEn: service?.nameEn ?? null,
    customerId: line.customerId,
    customerName: customer ?? null,
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
  const base = blank(ctx.label, 'SALE', `sale:${sale.saleId}`, amount);
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
  const base = blank(ctx.label, kind, `tip:${tip.sessionId}:${tip.method}`, tip.amount);
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
 * بند. لو رأس البند مش موجود، التفاصيل بتفضل null ومش بتتخترع.
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
    `correction:${correction.id}`,
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
  const head = lineId === null ? undefined : ctx.correctionLineDetails.get(lineId);
  const service = head === undefined ? undefined : ctx.names.services.get(head.serviceId);
  const customerId = head?.customerId ?? null;
  const customer = customerId === null ? undefined : ctx.names.customers.get(customerId);
  return {
    ...placedRow,
    previousAmount: moneyToString(correction.previousAmount),
    newAmount: moneyToString(correction.newAmount),
    sourcePeriod: correction.sourcePeriod,
    lineId: head === undefined ? null : lineId,
    sessionId: head?.sessionId ?? null,
    serviceId: head?.serviceId ?? null,
    serviceNameAr: service?.nameAr ?? null,
    serviceNameEn: service?.nameEn ?? null,
    customerId,
    customerName: customer ?? null,
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
  const kind = carry.kind === 'COMMISSION' ? 'CARRY_COMMISSION' : 'CARRY_TIP_CARD';
  const base = blank(
    ctx.label,
    kind,
    `carry:${carry.sourceStatementId}:${carry.kind}`,
    carry.amount,
  );
  return { ...base, sourcePeriod: carry.sourcePeriod };
}
