import {
  commissionOverrideOf,
  commissionPlanVersionOf,
  commissionRuleOf,
  projectPackageSaleStatus,
  type CommissionPlanVersion,
  type RevisedSalary,
  type ServiceCommissionOverride,
  type StatementCorrectionSource,
  type StatementLineSource,
  type StatementMonthRows,
  type StatementSaleSource,
  type StatementTipSource,
} from '@pospay/commissions-engine';
import { parseMoney } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

import { readIncomingCarries } from './commission-carry-reader.ts';
import type {
  CorrectionRow,
  LineRow,
  OverrideRow,
  PlanVersionRow,
  SalaryRow,
  SaleRow,
  TipRow,
} from './commission-month-row-types.ts';

/**
 * شرط الموظفة الواحد: من غير موظفة بيفضل الشرط فاضي، ومع موظفة بيقصر القراءة
 * على شهرها هي بس من غير ما narrowed التسعير (CS-Q24).
 */
function employeeFilter(alias: string, column: string, employeeId: string | null): SQL {
  if (employeeId === null) return sql``;
  return sql`AND ${sql.identifier(alias)}.${sql.identifier(column)} = ${employeeId}::uuid`;
}

/**
 * يقرأ صفوف شهر النشاط من إسقاط العمولة نفسه، كلها في نفس المعاملة عشان الأرقام
 * تيجي من لقطة واحدة. الصفوف بتشيل كمان نسخة الرأس والجلسة والعميل ومعرّف التصحيح اللي الكشف
 * وبصمته محتاجينهم؛ التقدير بيتجاهلهم.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param period الشهر المطلوب بصيغة YYYY-MM
 * @param employeeId موظفة واحدة اختيارية
 * @returns صفوف الشهر
 */
export async function readEstimateMonth(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<StatementMonthRows> {
  const lines = await readLines(tx, companyId, businessId, period, employeeId);
  const sales = await readSales(tx, companyId, businessId, period, employeeId);
  const tips = await readTips(tx, companyId, businessId, period, employeeId);
  const salaries = await readSalaries(tx, companyId, businessId, period, employeeId);
  const versions = await readPlanVersions(tx, companyId, businessId, period, employeeId);
  const overrides = await readOverrides(tx, companyId, businessId, period, employeeId);
  const corrections = await readCorrections(tx, companyId, businessId, period, employeeId);
  const carries = await readIncomingCarries(tx, companyId, businessId, period, employeeId);
  return { lines, sales, tips, salaries, versions, overrides, corrections, carries };
}

async function readLines(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<StatementLineSource[]> {
  const rows = await tx.execute<LineRow>(sql`SELECT
    l.employee_id AS "employeeId", l.service_id AS "serviceId",
    h.branch_id AS "branchId", l.line_id AS "lineId",
    h.session_id AS "sessionId", h.customer_id AS "customerId", h.revision AS "revision",
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
      ${employeeFilter('l', 'employee_id', employeeId)}
    ORDER BY l.employee_id, l.line_id`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    serviceId: row.serviceId,
    branchId: row.branchId,
    lineId: row.lineId,
    sessionId: row.sessionId,
    customerId: row.customerId,
    revision: BigInt(row.revision),
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
  employeeId: string | null,
): Promise<StatementSaleSource[]> {
  const rows = await tx.execute<SaleRow>(sql`SELECT
    sale_id AS "saleId", seller_employee_id AS "sellerEmployeeId", branch_id AS "branchId",
    business_date::text AS "businessDate", price_paid::text AS "pricePaid",
    refunded_amount::text AS "refundedAmount", status AS "status",
    revision AS "revision"
    FROM commission_sales
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND period = ${period}
      ${employeeFilter('commission_sales', 'seller_employee_id', employeeId)}
    ORDER BY seller_employee_id, sale_id`);
  return rows.map((row) => ({
    saleId: row.saleId,
    sellerEmployeeId: row.sellerEmployeeId,
    branchId: row.branchId,
    businessDate: row.businessDate,
    pricePaid: parseMoney(row.pricePaid),
    refundedAmount: parseMoney(row.refundedAmount),
    status: projectPackageSaleStatus(row.status),
    revision: BigInt(row.revision),
  }));
}

async function readTips(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<StatementTipSource[]> {
  const rows = await tx.execute<TipRow>(sql`SELECT
    t.session_id AS "sessionId", t.employee_id AS "employeeId", h.branch_id AS "branchId",
    t.method AS "method", t.amount::text AS amount, h.business_date::text AS "businessDate",
    h.revision AS "revision"
    FROM commission_tips t
    JOIN commission_tip_heads h ON h.company_id = t.company_id
      AND h.business_id = t.business_id AND h.session_id = t.session_id
    WHERE t.company_id = ${companyId} AND t.business_id = ${businessId}::uuid
      AND h.period = ${period}
      ${employeeFilter('t', 'employee_id', employeeId)}
    ORDER BY t.employee_id, t.session_id, t.method`);
  return rows.map((row) => ({
    sessionId: row.sessionId,
    employeeId: row.employeeId,
    branchId: row.branchId,
    businessDate: row.businessDate,
    method: row.method === 'CASH' ? 'CASH' : 'CARD',
    amount: parseMoney(row.amount),
    revision: BigInt(row.revision),
  }));
}

async function readSalaries(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<RevisedSalary[]> {
  const rows = await tx.execute<SalaryRow>(sql`SELECT
    employee_id AS "employeeId", effective_from::text AS "effectiveFrom", amount::text AS amount,
    revision AS "revision"
    FROM commission_salaries
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
      ${employeeFilter('commission_salaries', 'employee_id', employeeId)}
    ORDER BY employee_id, effective_from`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    amount: parseMoney(row.amount),
    revision: BigInt(row.revision),
  }));
}

async function readPlanVersions(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<CommissionPlanVersion[]> {
  // نسخة الإصلاح (repair_period) بتبقى فعّالة في شهرها بس، وقاعدة البيانات بتربط
  // تاريخ سريانها بأول يوم في الشهر ده. الفلتر بيحافظ عليها صراحةً عشان Motors
  // تختارها بنفس الشهر، والفلتر في التجميع المشترك بيفضل متطابق (D-12, CS-Q11).
  const rows = await tx.execute<PlanVersionRow>(sql`SELECT
    employee_id AS "employeeId", version AS "version",
    effective_from::text AS "effectiveFrom", whole_period AS "wholePeriod",
    repair_period AS "repairPeriod", plan AS plan,
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_plan_versions
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND (effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
        OR repair_period = ${period})
      ${employeeFilter('commission_plan_versions', 'employee_id', employeeId)}
    ORDER BY employee_id, version`);
  return rows.map(commissionPlanVersionOf);
}

async function readOverrides(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<ServiceCommissionOverride[]> {
  const rows = await tx.execute<OverrideRow>(sql`SELECT
    id AS "id", employee_id AS "employeeId", service_id AS "serviceId",
    effective_from::text AS "effectiveFrom", rule_kind AS "ruleKind",
    rule_pct_bps AS "rulePctBps", rule_fixed_amount::text AS "ruleFixedAmount",
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_service_overrides
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND effective_from <= (date_trunc('month', (${period} || '-01')::date) + interval '1 month - 1 day')::date
      ${employeeFilter('commission_service_overrides', 'employee_id', employeeId)}
    ORDER BY employee_id, created_at, id`);
  return rows.map(commissionOverrideOf);
}

async function readCorrections(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<StatementCorrectionSource[]> {
  const rows = await tx.execute<CorrectionRow>(sql`SELECT
    id AS "id", employee_id AS "employeeId", source_period AS "sourcePeriod",
    target_period AS "targetPeriod", source_ref AS "sourceRef", kind AS "kind",
    amount::text AS amount, previous_amount::text AS "previousAmount",
    new_amount::text AS "newAmount", generation AS "generation",
    source_branch_id AS "sourceBranchId", source_business_date::text AS "sourceBusinessDate",
    attached_branch_ids AS "attachedBranchIds"
    FROM commission_corrections
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND target_period = ${period}
      ${employeeFilter('commission_corrections', 'employee_id', employeeId)}
    ORDER BY employee_id, source_ref, generation`);
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    sourcePeriod: row.sourcePeriod,
    targetPeriod: row.targetPeriod,
    sourceRef: row.sourceRef,
    kind: row.kind as StatementCorrectionSource['kind'],
    amount: parseMoney(row.amount),
    previousAmount: parseMoney(row.previousAmount),
    newAmount: parseMoney(row.newAmount),
    generation: BigInt(row.generation),
    sourceBranchId: row.sourceBranchId,
    sourceBusinessDate: row.sourceBusinessDate,
    attachedBranchIds: [...row.attachedBranchIds],
  }));
}
