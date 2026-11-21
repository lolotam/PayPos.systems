import { parseMoney, type Money } from '@pospay/domain';

import { CommissionSaleInputInvalidError } from './errors.ts';

/**
 * سقف مراجعة البيع: عمود commission_sales.revision عدد صحيح PostgreSQL (int4)،
 * ومراجعة أعلى من ذلك خطأ عند المنتج (FR-017) يرفضه المسار المستمر المكتوب
 * COMMISSION_SALE_INPUT_INVALID بدل خطأ تجاوز قاعدة البيانات.
 */
const MAX_SALE_REVISION = 2_147_483_647;

/** حدث تغيّر بيع باقة؛ هويته وتاريخه متحقَّقان قبل هذا الملف، والمال نصي كما في العقد. */
export interface CommissionSaleInputEvent {
  readonly businessId: string;
  readonly branchId: string;
  readonly saleId: string;
  readonly sellerEmployeeId: string;
  readonly businessDate: string;
  readonly pricePaid: string;
  readonly refundedAmount: string;
  readonly status: string;
  readonly revision: number;
}

/** صف بيع باقة في إسقاط العمولة: الشهر مشتق من يوم العمل ولا يُقرأ من sold_at. */
export interface CommissionSaleProjectionRow {
  readonly businessId: string;
  readonly saleId: string;
  readonly branchId: string;
  readonly sellerEmployeeId: string;
  readonly businessDate: string;
  readonly period: string;
  readonly pricePaid: Money;
  readonly refundedAmount: Money;
  readonly status: string;
  readonly revision: number;
}

/** نتيجة تخفيض حدث البيع: هل طُبِّق، وصف البيع بعده. */
export interface CommissionSaleProjectionOutcome {
  readonly applied: boolean;
  readonly row: CommissionSaleProjectionRow | null;
}

/**
 * يطبّق حدث بيع الباقة على إسقاط العمولة (CM-20).
 * البيع مفتاحه هوية البيع: المراجعة الأحدث تستبدل الصف كله، والمساوية أو الأقدم
 * ما بتعملش حاجة، ووصول الأحداث بأي ترتيب بيوصل لنفس الصف (CM-21).
 *
 * @param held الصف المحفوظ بعد قفل هوية البيع، أو null عند غيابه
 * @param event حدث البيع بمراجعته ومبالغه الكاملة
 * @returns هل طُبِّق الحدث، وصف البيع بعده
 */
export function reduceCommissionSale(
  held: CommissionSaleProjectionRow | null,
  event: CommissionSaleInputEvent,
): CommissionSaleProjectionOutcome {
  // المراجعة فوق مدى عمود integer خطأ عند المنتج (FR-017)، فتُرفض هنا قبل أي مقارنة أو كتابة.
  if (event.revision > MAX_SALE_REVISION) {
    throw new CommissionSaleInputInvalidError('REVISION_OUT_OF_RANGE');
  }
  if (event.revision <= (held?.revision ?? 0)) {
    return { applied: false, row: null };
  }
  const pricePaid = parseSaleAmount(event.pricePaid, 'MALFORMED_PRICE_PAID');
  const refundedAmount = parseSaleAmount(event.refundedAmount, 'MALFORMED_REFUNDED_AMOUNT');
  // المرتجع أعلى من المدفوع خطأ عند المنتج (FR-017)، فالحدث يتوقف بدل ما يُسقَط برقم سالب.
  if (refundedAmount > pricePaid) {
    throw new CommissionSaleInputInvalidError('REFUND_ABOVE_PRICE');
  }
  const row: CommissionSaleProjectionRow = {
    businessId: event.businessId,
    saleId: event.saleId,
    branchId: event.branchId,
    sellerEmployeeId: event.sellerEmployeeId,
    businessDate: event.businessDate,
    period: periodOfSaleBusinessDate(event.businessDate),
    pricePaid,
    refundedAmount,
    status: event.status,
    revision: event.revision,
  };
  return { applied: true, row };
}

/**
 * يجمع شهر البيع المحفوظ مع شهر تاريخ الحدث الجديد حتى يُفتح كل شهر تغيّرت مدخلاته،
 * مثلاً مرتجع نقل البيع من شهر لآخر (FR-018).
 *
 * @param heldPeriod شهر النسخة المحفوظة، أو null عندما لا توجد نسخة سابقة
 * @param newBusinessDate يوم عمل البيع الجديد بصيغة YYYY-MM-DD
 * @returns الشهور المتأثرة فريدة ومرتبة تصاعدياً
 */
export function saleAffectedPeriods(
  heldPeriod: string | null,
  newBusinessDate: string,
): string[] {
  const periods = new Set<string>([periodOfSaleBusinessDate(newBusinessDate)]);
  if (heldPeriod !== null) periods.add(heldPeriod);
  return [...periods].sort();
}

/**
 * يرفض نقل بيع موجود إلى نشاط آخر؛ النشاط جزء ثابت من هوية الإسقاط،
 * والمراجعة الأحدث تغيّر الفرع والبائع ويوم العمل لا النشاط (spec 058 TD-7).
 *
 * @param held الصف المحفوظ بعد قفل هوية البيع، أو null عند غيابه
 * @param event حدث البيع الوارد بهوية النشاط المطلوبة
 * @returns لا شيء عند ثبات هوية النشاط
 */
export function assertSaleIdentityUnchanged(
  held: CommissionSaleProjectionRow | null,
  event: CommissionSaleInputEvent,
): void {
  if (held !== null && held.businessId.toLowerCase() !== event.businessId.toLowerCase()) {
    throw new CommissionSaleInputInvalidError('SALE_BUSINESS_CHANGED');
  }
}

/**
 * يشتق شهر البيع من أول سبعة أحرف من يوم العمل، فالشهر قرار الحدث لا مشتقّ وقت البيع (CM-20).
 *
 * @param businessDate يوم عمل البيع بصيغة YYYY-MM-DD
 * @returns الشهر بصيغة YYYY-MM
 */
function periodOfSaleBusinessDate(businessDate: string): string {
  if (businessDate.startsWith('0000-')) {
    throw new CommissionSaleInputInvalidError('BUSINESS_DATE_OUT_OF_RANGE');
  }
  return businessDate.slice(0, 7);
}

/**
 * يحوّل مبلغ نصي بالدينار إلى فلوس، ويرفض المبلغ المشوّه أو السالب بدل ما يتحوّل لصفر.
 * المبلغ المشوّه خطأ عند المنتج (FR-017)، فالحدث يتوقف حتى يُصلَح بدل ما يضيع.
 *
 * @param amount المبلغ النصي كما وصل من الحدث
 * @param reason سبب الرفض اللي الخطأ يحمله
 * @returns المبلغ بالفلوس
 */
function parseSaleAmount(amount: string, reason: string): Money {
  if (typeof amount !== 'string') throw new CommissionSaleInputInvalidError(reason);
  try {
    const money = parseMoney(amount);
    if (money < 0n) throw new CommissionSaleInputInvalidError(reason);
    return money;
  } catch (error) {
    if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
    throw new CommissionSaleInputInvalidError(reason);
  }
}
