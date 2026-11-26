import { moneyToString, type Money } from '@pospay/domain';

/** حقائق الاسترداد كما يستعملها الحدث؛ بلا سبب وبلا اسم عميل وبلا هوية المسترد. */
export interface PackageRefundRecordedFacts {
  readonly refundId: string;
  readonly entitlementId: string;
  readonly componentId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly sessions: number;
  readonly amount: Money;
  readonly businessDate: string;
  readonly refundedAt: Date;
  readonly entitlementRevision: number;
}

/** حمولة PackageRefundRecorded كما يراها المستهلك؛ الحقول كلها موجودة والنسخة بعد الاسترداد. */
export interface PackageRefundRecordedPayload {
  readonly schema_version: 1;
  readonly refund_id: string;
  readonly entitlement_id: string;
  readonly component_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly sessions: number;
  readonly amount: string;
  readonly business_date: string;
  readonly refunded_at: string;
  readonly entitlement_revision: number;
}

/**
 * يبني حمولة PackageRefundRecorded من سطر الاسترداد بعد ما اتثبت.
 * الفرع واليوم المحاسبي بتوع الاسترداد نفسه مش بتوع البيع، والمبلغ بنص من ثلاث خانات.
 * السبب واسم العميل وتليفونه وهوية المسترد مش في الحمولة أبدًا: تتبقى في سطر الاسترداد المحروس.
 *
 * @param facts هوية الاسترداد والمبلغ والتاريخ والنسخة بعد الاسترداد
 * @returns حمولة PackageRefundRecorded جاهزة للتفسير عبر العقد
 */
export function packageRefundRecorded(
  facts: PackageRefundRecordedFacts,
): PackageRefundRecordedPayload {
  return {
    schema_version: 1,
    refund_id: facts.refundId,
    entitlement_id: facts.entitlementId,
    component_id: facts.componentId,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    sessions: facts.sessions,
    amount: moneyToString(facts.amount),
    business_date: facts.businessDate,
    refunded_at: facts.refundedAt.toISOString(),
    entitlement_revision: facts.entitlementRevision,
  };
}
