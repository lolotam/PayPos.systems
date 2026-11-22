import {
  commissionOverrideOf,
  commissionPlanVersionOf,
  commissionRuleOf,
  projectPackageSaleStatus,
  type CommissionPlanVersion,
  type CommissionSalary,
  type ServiceCommissionOverride,
} from '@pospay/commissions-engine';
import { parseMoney } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  CommissionEstimateCorrection,
  CommissionEstimateLine,
  CommissionEstimateMonthRows,
  CommissionEstimateProviders,
  CommissionEstimateReads,
  CommissionEstimateSale,
  CommissionEstimateTip,
} from '../ports/commission-estimate.port.ts';

type LineRow = {
  employeeId: string;
  serviceId: string;
  branchId: string;
  lineId: string;
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

type SaleRow = {
  saleId: string;
  sellerEmployeeId: string | null;
  branchId: string;
  businessDate: string;
  pricePaid: string;
  refundedAmount: string;
  status: string;
};

type TipRow = {
  sessionId: string;
  employeeId: string;
  branchId: string;
  method: string;
  amount: string;
  businessDate: string;
};

type SalaryRow = {
  employeeId: string;
  effectiveFrom: string;
  amount: string;
};

type PlanVersionRow = {
  employeeId: string;
  version: number;
  effectiveFrom: string;
  wholePeriod: boolean;
  repairPeriod: string | null;
  plan: unknown;
  createdAt: string;
};

type OverrideRow = {
  id: string;
  employeeId: string;
  serviceId: string;
  effectiveFrom: string;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  createdAt: string;
};

type CorrectionRow = {
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

/**
 * يبني قراءات تقدير العمولة على معاملة القراءة نفسها: النطاق والميزة والاسم
 * والارتباطات من مزوديهم، وصفوف الشهر من إسقاط العمولة نفسه.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param providers مزودو النطاق والاسم والارتباطات المربوطين في جذر التطبيق
 * @returns قراءات التقدير مربوطة بالمعاملة
 */
export function createCommissionEstimateReads(
  tx: Tx,
  companyId: string,
  providers: CommissionEstimateProviders,
): CommissionEstimateReads {
  return {
    scope: (scopeCompanyId, userId, businessId) =>
      providers.scope(tx, scopeCompanyId, userId, businessId),
    featureEnabled: (featureCompanyId) =>
      providers.featureEnabled(tx, featureCompanyId),
    employees: (businessId) => providers.employees(tx, companyId, businessId),
    attachments: (businessId, employeeIds) =>
      providers.attachments(tx, companyId, businessId, employeeIds),
    serviceNames: (businessId, serviceIds) =>
      providers.serviceNames(tx, companyId, businessId, serviceIds),
    month: (businessId, period) => readEstimateMonth(tx, companyId, businessId, period),
  };
}

async function readEstimateMonth(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionEstimateMonthRows> {
  const lines = await readLines(tx, companyId, businessId, period);
  const sales = await readSales(tx, companyId, businessId, period);
  const tips = await readTips(tx, companyId, businessId, period);
  const salaries = await readSalaries(tx, companyId, businessId, period);
  const versions = await readPlanVersions(tx, companyId, businessId, period);
  const overrides = await readOverrides(tx, companyId, businessId, period);
  const corrections = await readCorrections(tx, companyId, businessId, period);
  return { lines, sales, tips, salaries, versions, overrides, corrections };
}

async function readLines(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionEstimateLine[]> {
  const rows = await tx.execute<LineRow>(sql`SELECT
    l.employee_id AS "employeeId", l.service_id AS "serviceId",
    h.branch_id AS "branchId", l.line_id AS "lineId",
    (extract(epoch from l.occurred_at)*1000000)::bigint::text AS "occurredAt",
    (extract(epoch from l.recorded_at)*1000000)::bigint::text AS "recordedAt",
    l.business_date::text AS "businessDate", l.net_share::text AS "netShare",
    l.share_bps AS "shareBps", l.counts AS "counts", l.rule_kind AS "ruleKind",
    l.rule_pct_bps AS "rulePctBps", l.rule_fixed_amount::text AS "ruleFixedAmount",
    h.status AS "status"
    FROM commission_lines l
    JOIN commission_line_heads h ON h.company_id = l.company_id AND h.line_id = l.line_id
    WHERE l.company_id = ${companyId} AND l.business_id = ${businessId}::uuid
      AND l.period = ${period}
    ORDER BY l.employee_id, l.line_id`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    serviceId: row.serviceId,
    branchId: row.branchId,
    lineId: row.lineId,
    occurredAt: BigInt(row.occurredAt),
    recordedAt: BigInt(row.recordedAt),
    businessDate: row.businessDate,
    netShare: parseMoney(row.netShare),
    shareBps: BigInt(row.shareBps),
    counts: row.counts,
    ruleSnapshot: commissionRuleOf(row.ruleKind, row.rulePctBps, row.ruleFixedAmount),
    status: row.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
  }));
}

async function readSales(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionEstimateSale[]> {
  const rows = await tx.execute<SaleRow>(sql`SELECT
    sale_id AS "saleId", seller_employee_id AS "sellerEmployeeId", branch_id AS "branchId",
    business_date::text AS "businessDate", price_paid::text AS "pricePaid",
    refunded_amount::text AS "refundedAmount", status AS "status"
    FROM commission_sales
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND period = ${period}
    ORDER BY seller_employee_id, sale_id`);
  return rows.map((row) => ({
    saleId: row.saleId,
    sellerEmployeeId: row.sellerEmployeeId,
    branchId: row.branchId,
    businessDate: row.businessDate,
    pricePaid: parseMoney(row.pricePaid),
    refundedAmount: parseMoney(row.refundedAmount),
    status: projectPackageSaleStatus(row.status),
  }));
}

async function readTips(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionEstimateTip[]> {
  const rows = await tx.execute<TipRow>(sql`SELECT
    t.session_id AS "sessionId", t.employee_id AS "employeeId", h.branch_id AS "branchId",
    t.method AS "method", t.amount::text AS amount, h.business_date::text AS "businessDate"
    FROM commission_tips t
    JOIN commission_tip_heads h ON h.company_id = t.company_id
      AND h.business_id = t.business_id AND h.session_id = t.session_id
    WHERE t.company_id = ${companyId} AND t.business_id = ${businessId}::uuid
      AND h.period = ${period}
    ORDER BY t.employee_id, t.session_id, t.method`);
  return rows.map((row) => ({
    sessionId: row.sessionId,
    employeeId: row.employeeId,
    branchId: row.branchId,
    businessDate: row.businessDate,
    method: row.method === 'CASH' ? 'CASH' : 'CARD',
    amount: parseMoney(row.amount),
  }));
}

async function readSalaries(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionSalary[]> {
  const rows = await tx.execute<SalaryRow>(sql`SELECT
    employee_id AS "employeeId", effective_from::text AS "effectiveFrom", amount::text AS amount
    FROM commission_salaries
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY employee_id, effective_from`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    amount: parseMoney(row.amount),
  }));
}

async function readPlanVersions(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionPlanVersion[]> {
  const rows = await tx.execute<PlanVersionRow>(sql`SELECT
    employee_id AS "employeeId", version AS "version",
    effective_from::text AS "effectiveFrom", whole_period AS "wholePeriod",
    repair_period AS "repairPeriod", plan AS plan,
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_plan_versions
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY employee_id, version`);
  return rows.map(commissionPlanVersionOf);
}

async function readOverrides(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<ServiceCommissionOverride[]> {
  const rows = await tx.execute<OverrideRow>(sql`SELECT
    id AS "id", employee_id AS "employeeId", service_id AS "serviceId",
    effective_from::text AS "effectiveFrom", rule_kind AS "ruleKind",
    rule_pct_bps AS "rulePctBps", rule_fixed_amount::text AS "ruleFixedAmount",
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_service_overrides
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY employee_id, created_at, id`);
  return rows.map(commissionOverrideOf);
}

async function readCorrections(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
): Promise<CommissionEstimateCorrection[]> {
  const rows = await tx.execute<CorrectionRow>(sql`SELECT
    employee_id AS "employeeId", source_period AS "sourcePeriod",
    target_period AS "targetPeriod", source_ref AS "sourceRef", kind AS "kind",
    amount::text AS amount, previous_amount::text AS "previousAmount",
    new_amount::text AS "newAmount", generation AS "generation",
    source_branch_id AS "sourceBranchId", source_business_date::text AS "sourceBusinessDate",
    attached_branch_ids AS "attachedBranchIds"
    FROM commission_corrections
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND target_period = ${period}
    ORDER BY employee_id, source_ref, generation`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    sourcePeriod: row.sourcePeriod,
    targetPeriod: row.targetPeriod,
    sourceRef: row.sourceRef,
    kind: row.kind as CommissionEstimateCorrection['kind'],
    amount: parseMoney(row.amount),
    previousAmount: parseMoney(row.previousAmount),
    newAmount: parseMoney(row.newAmount),
    generation: BigInt(row.generation),
    sourceBranchId: row.sourceBranchId,
    sourceBusinessDate: row.sourceBusinessDate,
    attachedBranchIds: [...row.attachedBranchIds],
  }));
}
