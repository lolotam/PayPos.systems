/** مدخلات بيع الباقة التي يحتاجها إنشاء الطلب المعلق دون الاعتماد على عقد خارجي. */
export type PackageSaleInput = {
  customer_id: string;
  package_type_id: string;
  expected_type_revision: number;
  expected_service_revisions: readonly { service_id: string; revision: number }[];
  price_paid: string;
  paid_method: 'CASH' | 'CARD';
  seller_employee_id: string;
  sold_at?: string | undefined;
};

/** حقائق السلطة المؤكدة اللازمة لتجميد لقطة قبول بيع الباقة. */
export type PackageSaleRequestFacts = {
  id: string;
  companyId: string;
  businessId: string;
  branchId: string;
  recorderUserId: string;
  recorderMembershipId: string;
  limitBps: number | null;
  recordedAt: Date;
};

/**
 * يبني صف طلب بيع معلق من مدخلات العميل وحقائق السلطة المؤكدة.
 * القبول يجمد حد خصم المسجلة ووقت التسجيل فقط، ويترك فحص العميلة والنوع والبائعة والسعر للعامل.
 *
 * @param input مدخلات بيع الباقة اللازمة لإنشاء الطلب المعلق
 * @param facts هوية الطلب ونطاقه ومسجله وحد الخصم ولحظة القبول
 * @returns صف package_sale_requests بحالة pending جاهز للإدخال
 */
export function pendingPackageSale(input: PackageSaleInput, facts: PackageSaleRequestFacts) {
  return {
    company_id: facts.companyId,
    id: facts.id,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    recorded_by: facts.recorderUserId,
    recorded_by_membership_id: facts.recorderMembershipId,
    discount_limit_bps: facts.limitBps,
    customer_id: input.customer_id,
    package_type_id: input.package_type_id,
    expected_type_revision: input.expected_type_revision,
    expected_service_revisions: input.expected_service_revisions,
    price_paid: input.price_paid,
    paid_method: input.paid_method,
    seller_employee_id: input.seller_employee_id,
    sold_at: input.sold_at === undefined ? null : new Date(input.sold_at),
    recorded_at: facts.recordedAt,
    status: 'pending' as const,
  };
}

/** صف طلب البيع المعلق؛ لقطة القبول كاملة قبل أن يفحص العامل مراجع البيع. */
export type PendingPackageSaleRequest = ReturnType<typeof pendingPackageSale>;
