/** صف بند الشهر كما يرجع من SQL: التواريخ نصوص والبصمة بالـmicrosecond نصاً. */
export type LineRow = {
  employeeId: string;
  serviceId: string;
  branchId: string;
  lineId: string;
  sessionId: string;
  customerId: string;
  revision: number;
  occurredAt: string;
  recordedAt: string;
  businessDate: string;
  netShare: string;
  shareBps: number;
  counts: boolean;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  status: string;
};

/** صف بيع الباقة كما يرجع من SQL. */
export type SaleRow = {
  saleId: string;
  sellerEmployeeId: string | null;
  branchId: string;
  businessDate: string;
  pricePaid: string;
  refundedAmount: string;
  status: string;
  revision: number;
};

/** صف بقشيش الجلسة كما يرجع من SQL. */
export type TipRow = {
  sessionId: string;
  employeeId: string;
  branchId: string;
  method: string;
  amount: string;
  businessDate: string;
  revision: number;
};

/** صف الراتب كما يرجع من SQL. */
export type SalaryRow = {
  employeeId: string;
  effectiveFrom: string;
  amount: string;
  revision: number;
};

/** صف نسخة الخطة كما يرجع من SQL. */
export type PlanVersionRow = {
  employeeId: string;
  version: number;
  effectiveFrom: string;
  wholePeriod: boolean;
  repairPeriod: string | null;
  plan: unknown;
  createdAt: string;
};

/** صف تجاوز الخدمة كما يرجع من SQL. */
export type OverrideRow = {
  id: string;
  employeeId: string;
  serviceId: string;
  effectiveFrom: string;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  createdAt: string;
};

/** صف التصحيح المستلم كما يرجع من SQL. */
export type CorrectionRow = {
  id: string;
  employeeId: string;
  sourcePeriod: string;
  targetPeriod: string;
  sourceRef: string;
  kind: string;
  amount: string;
  previousAmount: string;
  newAmount: string;
  generation: number;
  sourceBranchId: string;
  sourceBusinessDate: string;
  attachedBranchIds: string[];
};
