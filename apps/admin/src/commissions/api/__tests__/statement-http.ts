import type {
  CommissionClosedStatementBranchView,
  CommissionClosedStatementView,
  CommissionStatementBranchView,
  CommissionStatementEmployee,
  CommissionStatementRow,
  CommissionStatementView,
} from '@pospay/contracts';

export const statementPath = '/v1/businesses/{businessId}/commission-statements/{period}';
export const generatePath = `${statementPath}/generate`;
export const reviewPath = `${statementPath}/review`;
export const returnPath = `${statementPath}/return`;

export const PERIOD = '2026-10';
export const BUSINESS_ID = '01920000-0000-7000-8000-0000000000b2';
export const EMPLOYEE_SARA = '01920000-0000-7c11-8a11-0000000000a1';
export const EMPLOYEE_RANA = '01920000-0000-7c22-8a22-0000000000a2';
export const FP_INPUT = 'a'.repeat(64);
export const FP_STATEMENT = 'b'.repeat(64);

const BASE_ROW = {
  previous_amount: null,
  new_amount: null,
  source_period: null,
  source_branch_id: null,
  source_branch_name_ar: null,
  source_branch_name_en: null,
  source_business_date: null,
  service_name_ar: null,
  service_name_en: null,
  customer_name: null,
  business_date: null,
};

/** صف كشف بقيم افتراضية؛ كل اختبار بيغيّر اللي يهمه بس. */
export function statementRow(
  sourceRef: string,
  kind: CommissionStatementRow['kind'],
  amount: string,
  overrides: Partial<CommissionStatementRow> = {},
): CommissionStatementRow {
  return { ...BASE_ROW, source_ref: sourceRef, kind, amount, ...overrides };
}

/** صف عمولة خدمة: اليوم والخدمة والعميلة والفرع. */
export function dyeRow(): CommissionStatementRow {
  return statementRow('line:1', 'COMMISSION', '20.000', {
    business_date: '2026-10-12',
    service_name_en: 'Dyeing',
    service_name_ar: 'صبغة',
    customer_name: 'Noura Al-Test',
    source_branch_name_en: 'Salmiya',
    source_branch_name_ar: 'السالمية',
  });
}

/** صف تصحيح من شهر سابق: كان وبقى والفرق. */
export function correctionRow(ref: string, amount: string, previous: string, next: string) {
  return statementRow(ref, 'CORRECTION', amount, {
    business_date: '2026-09-20',
    source_business_date: '2026-10-02',
    source_period: '2026-09',
    service_name_en: 'Dyeing',
    service_name_ar: 'صبغة',
    previous_amount: previous,
    new_amount: next,
  });
}

/** موظفة في الكشف بمجاميعها، وصفوفها وملاحظاتها حسب الاختبار. */
export function statementEmployee(
  overrides: Partial<CommissionStatementEmployee> = {},
): CommissionStatementEmployee {
  return {
    employee_id: EMPLOYEE_SARA,
    employee_number: 7,
    name_ar: 'سارة',
    name_en: 'Sara',
    partial: false,
    commission_subtotal: '12.500',
    tip_side: '3.000',
    payable: '15.500',
    rows: [],
    issues: [],
    ...overrides,
  };
}

/** عرض قارئ النشاط كله لشهر مفتوح. */
export function businessView(overrides: Partial<CommissionStatementView> = {}): CommissionStatementView {
  return {
    reader_scope: 'BUSINESS',
    business_id: BUSINESS_ID,
    period: PERIOD,
    status: 'DRAFT',
    generated: true,
    current_fingerprint: FP_INPUT,
    current_statement_fingerprint: FP_STATEMENT,
    reviewed_fingerprint: null,
    reviewed_statement_fingerprint: null,
    changed_since_review: false,
    change_cause: null,
    employees: [statementEmployee()],
    ...overrides,
  };
}

/** عرض قارئ الفروع: من غير بصمات ولا أعلام تغيّر. */
export function branchView(overrides: Partial<CommissionStatementBranchView> = {}): CommissionStatementBranchView {
  return {
    reader_scope: 'BRANCHES',
    business_id: BUSINESS_ID,
    period: PERIOD,
    status: 'DRAFT',
    generated: true,
    employees: [statementEmployee({ partial: true })],
    ...overrides,
  };
}

export const approvePath = `${statementPath}/approve`;

/** عرض قارئ النشاط كله لشهر مغلق: الصفوف المجمّدة وبصمتا الاعتماد من غير حقول الكشف المفتوح. */
export function closedView(
  overrides: Partial<CommissionClosedStatementView> = {},
): CommissionClosedStatementView {
  return {
    reader_scope: 'BUSINESS',
    business_id: BUSINESS_ID,
    period: PERIOD,
    status: 'APPROVED',
    approved_at: '2026-11-02T09:00:00.000Z',
    input_fingerprint: FP_INPUT,
    statement_fingerprint: FP_STATEMENT,
    payment: null,
    employees: [statementEmployee()],
    ...overrides,
  };
}

/** عرض قارئ الفروع لشهر مغلق. */
export function closedBranchView(
  overrides: Partial<CommissionClosedStatementBranchView> = {},
): CommissionClosedStatementBranchView {
  return {
    reader_scope: 'BRANCHES',
    business_id: BUSINESS_ID,
    period: PERIOD,
    status: 'APPROVED',
    payment: null,
    employees: [statementEmployee({ partial: true })],
    ...overrides,
  };
}

export const markPaidPath = `${statementPath}/mark-paid`;
export const PAYER_ID = '01920000-0000-7c44-8a44-0000000000a4';

/** بيانات صرف قارئ النشاط كله: صفّين، المستحق الدقيق والمتصرف فعلاً، والملاحظة ومن سجّل ومتى. */
export function paymentOf(overrides: Record<string, unknown> = {}) {
  return {
    paid_on: '2026-11-05',
    paid_method: 'BANK_TRANSFER' as const,
    paid_note: 'Sent from the main account',
    paid_at: '2026-11-05T08:30:00.000Z',
    paid_by: PAYER_ID,
    paid_total: '19.500',
    payments: [
      { employee_id: EMPLOYEE_SARA, exact_payable: '15.500', paid_amount: '15.500' },
      { employee_id: EMPLOYEE_RANA, exact_payable: '4.000', paid_amount: '4.000' },
    ],
    ...overrides,
  };
}

/** شهر مصروف لقارئ النشاط كله، بسارة ورنا وبيانات الصرف. */
export function paidView(payment: Record<string, unknown> = {}): CommissionClosedStatementView {
  return closedView({
    status: 'PAID',
    employees: [statementEmployee(), statementEmployee({ employee_id: EMPLOYEE_RANA, name_en: 'Rana', name_ar: null, payable: '4.000' })],
    payment: paymentOf(payment),
  } as Partial<CommissionClosedStatementView>);
}

/** رد تسجيل الصرف من السيرفر: نتيجة الصرف مش الكشف كله. */
export function markPaidResponse(overrides: Record<string, unknown> = {}) {
  const { paid_on, paid_method, paid_note, paid_at, paid_by, paid_total, payments } = paymentOf();
  return {
    business_id: BUSINESS_ID,
    period: PERIOD,
    status: 'PAID',
    paid_on,
    paid_method,
    paid_note,
    paid_at,
    paid_by,
    paid_total,
    payments,
    ...overrides,
  };
}
