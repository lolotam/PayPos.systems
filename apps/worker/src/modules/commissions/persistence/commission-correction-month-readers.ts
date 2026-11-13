import type {
  CommissionPeriodProjection,
  CommissionPlanVersion,
  CommissionSalary,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ReceivedCommissionCorrection,
  ServiceCommissionOverride,
} from '@pospay/commissions-engine';
import { parseMoney } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CommissionCorrectionKind } from '../domain/commission-correction-step.ts';
import type { CommissionMonthProjectionInput } from '../ports/commission-correction.port.ts';
import {
  commissionOverrideOf,
  commissionPlanVersionOf,
  commissionRuleOf,
  type OverrideRow,
  type PlanVersionRow,
} from './commission-correction-codec.ts';

type LineRow = {
  lineId: string;
  employeeId: string;
  serviceId: string;
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

type TipRow = {
  sessionId: string;
  employeeId: string;
  method: string;
  amount: string;
  businessDate: string;
};

type SalaryRow = {
  employeeId: string;
  effectiveFrom: string;
  amount: string;
};

type ReceivedCorrectionRow = {
  employeeId: string;
  sourcePeriod: string;
  targetPeriod: string;
  sourceRef: string;
  kind: string;
  amount: string;
  previousAmount: string;
  newAmount: string;
  generation: number;
};

function projectedLine(row: LineRow): ProjectedCommissionLine {
  return {
    employeeId: row.employeeId,
    serviceId: row.serviceId,
    lineId: row.lineId,
    occurredAt: BigInt(row.occurredAt),
    recordedAt: BigInt(row.recordedAt),
    businessDate: row.businessDate,
    netShare: parseMoney(row.netShare),
    shareBps: BigInt(row.shareBps),
    counts: row.counts,
    ruleSnapshot: commissionRuleOf(row.ruleKind, row.rulePctBps, row.ruleFixedAmount),
    status: row.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
  };
}

function projectedTip(row: TipRow): ProjectedCommissionTip {
  return {
    sessionId: row.sessionId,
    employeeId: row.employeeId,
    businessDate: row.businessDate,
    method: row.method === 'CASH' ? 'CASH' : 'CARD',
    amount: parseMoney(row.amount),
  };
}

async function readLines(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<ProjectedCommissionLine[]> {
  const rows = await tx.execute<LineRow>(sql`SELECT
    l.line_id AS "lineId", l.employee_id AS "employeeId", l.service_id AS "serviceId",
    (extract(epoch from l.occurred_at)*1000000)::bigint::text AS "occurredAt",
    (extract(epoch from l.recorded_at)*1000000)::bigint::text AS "recordedAt",
    l.business_date::text AS "businessDate", l.net_share::text AS "netShare",
    l.share_bps AS "shareBps", l.counts AS "counts", l.rule_kind AS "ruleKind",
    l.rule_pct_bps AS "rulePctBps", l.rule_fixed_amount::text AS "ruleFixedAmount",
    h.status AS "status"
    FROM commission_lines l
    JOIN commission_line_heads h ON h.company_id = l.company_id AND h.line_id = l.line_id
    WHERE l.company_id = app_company_id() AND l.business_id = ${input.businessId}::uuid
      AND l.employee_id = ${input.employeeId}::uuid AND l.period = ${input.period}
    ORDER BY l.line_id, l.employee_id`);
  return rows.map(projectedLine);
}

async function readTips(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<ProjectedCommissionTip[]> {
  const rows = await tx.execute<TipRow>(sql`SELECT
    t.session_id AS "sessionId", t.employee_id AS "employeeId", t.method AS "method",
    t.amount::text AS amount, h.business_date::text AS "businessDate"
    FROM commission_tips t
    JOIN commission_tip_heads h ON h.company_id = t.company_id
      AND h.business_id = t.business_id AND h.session_id = t.session_id
    WHERE t.company_id = app_company_id() AND t.business_id = ${input.businessId}::uuid
      AND t.employee_id = ${input.employeeId}::uuid AND h.period = ${input.period}
    ORDER BY t.session_id, t.method`);
  return rows.map(projectedTip);
}

async function readSalaries(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<readonly CommissionSalary[]> {
  const rows = await tx.execute<SalaryRow>(sql`SELECT
    employee_id AS "employeeId", effective_from::text AS "effectiveFrom", amount::text AS amount
    FROM commission_salaries
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid
      AND effective_from <= (date_trunc('month', (${input.period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY effective_from`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    amount: parseMoney(row.amount),
  }));
}

async function readPlanVersions(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<CommissionPlanVersion[]> {
  const rows = await tx.execute<PlanVersionRow>(sql`SELECT
    employee_id AS "employeeId", version AS "version",
    effective_from::text AS "effectiveFrom", whole_period AS "wholePeriod", plan AS plan,
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_plan_versions
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid
      AND effective_from <= (date_trunc('month', (${input.period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY version`);
  return rows.map(commissionPlanVersionOf);
}

async function readOverrides(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<ServiceCommissionOverride[]> {
  const rows = await tx.execute<OverrideRow>(sql`SELECT
    id AS "id", employee_id AS "employeeId", service_id AS "serviceId",
    effective_from::text AS "effectiveFrom", rule_kind AS "ruleKind",
    rule_pct_bps AS "rulePctBps", rule_fixed_amount::text AS "ruleFixedAmount",
    (extract(epoch from created_at)*1000000)::bigint::text AS "createdAt"
    FROM commission_service_overrides
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid
      AND effective_from <= (date_trunc('month', (${input.period} || '-01')::date) + interval '1 month - 1 day')::date
    ORDER BY created_at, id`);
  return rows.map(commissionOverrideOf);
}

async function readReceivedCorrections(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<ReceivedCommissionCorrection[]> {
  const rows = await tx.execute<ReceivedCorrectionRow>(sql`SELECT
    employee_id AS "employeeId", source_period AS "sourcePeriod",
    target_period AS "targetPeriod", source_ref AS "sourceRef", kind AS "kind",
    amount::text AS amount, previous_amount::text AS "previousAmount",
    new_amount::text AS "newAmount", generation AS "generation"
    FROM commission_corrections
    WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
      AND employee_id = ${input.employeeId}::uuid AND target_period = ${input.period}
    ORDER BY source_ref, generation`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    sourcePeriod: row.sourcePeriod,
    targetPeriod: row.targetPeriod,
    sourceRef: row.sourceRef,
    kind: row.kind as CommissionCorrectionKind,
    amount: parseMoney(row.amount),
    previousAmount: parseMoney(row.previousAmount),
    newAmount: parseMoney(row.newAmount),
    generation: BigInt(row.generation),
  }));
}

/**
 * يرجع إسقاط الموظفة وشهرها كما يفهمه محرك العمولة.
 * بيع الباقة لسه مش مدعوم قبل 50-4، فقائمة البيع فاضية وما فيش مصدر بيع بيتحسب.
 *
 * @param tx معاملة withTenant الحالية؛ ما ينفع تفتح معاملة تانية
 * @param input النشاط والموظفة والشهر
 * @returns إسقاط الشهر بالمدخلات الحالية
 */
export async function readMonthProjection(
  tx: Tx,
  input: CommissionMonthProjectionInput,
): Promise<CommissionPeriodProjection> {
  return {
    employeeId: input.employeeId,
    period: input.period,
    lines: await readLines(tx, input),
    sales: [],
    salaries: await readSalaries(tx, input),
    versions: await readPlanVersions(tx, input),
    overrides: await readOverrides(tx, input),
    tips: await readTips(tx, input),
    corrections: await readReceivedCorrections(tx, input),
  };
}
