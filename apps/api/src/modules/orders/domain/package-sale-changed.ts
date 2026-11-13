import { moneyToString, type Money } from '@pospay/domain';

/** لقطة البيع التي يحملها الحدث؛ فرع البيع ويومه بيتبانوا من بيع نفسه مش من فرع الاسترداد. */
export interface PackageSaleChangedFacts {
  readonly saleId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly soldAt: Date;
  readonly businessDate: string;
  readonly sellerEmployeeId: string;
  readonly pricePaid: Money;
  readonly refundedAmount: Money;
  readonly revision: number;
}

/** حمولة PackageSaleChanged كما يراها المستهلك: الحقول كلها موجودة والحالة SOLD. */
export interface PackageSaleChangedPayload {
  readonly sale_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly sold_at: string;
  readonly business_date: string;
  readonly seller_employee_id: string;
  readonly price_paid: string;
  readonly refunded_amount: string;
  readonly status: 'SOLD';
  readonly revision: number;
  readonly schema_version: 1;
}

/**
 * يبني حمولة PackageSaleChanged من لقطة البيع بعد الاسترداد.
 * الفرع واليوم المحاسبي بتبقا من البيع الأصلي، والمبلغ المسترد هو المحموع بعد الاسترداد ده، والمال بنص من ثلاث خانات.
 * الباقة المستوردة ما بتنشرش الحدث أصلاً، فالحالة SOLD بس.
 *
 * @param facts لقطة البيع والنسخة الجديدة والمبلغ المسترد
 * @returns حمولة PackageSaleChanged جاهزة للتفسير عبر العقد
 */
export function packageSaleChanged(facts: PackageSaleChangedFacts): PackageSaleChangedPayload {
  return {
    sale_id: facts.saleId,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    sold_at: facts.soldAt.toISOString(),
    business_date: facts.businessDate,
    seller_employee_id: facts.sellerEmployeeId,
    price_paid: moneyToString(facts.pricePaid),
    refunded_amount: moneyToString(facts.refundedAmount),
    status: 'SOLD',
    revision: facts.revision,
    schema_version: 1,
  };
}
