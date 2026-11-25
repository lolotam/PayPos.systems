import {
  computeClosedOwnCommissionEstimate,
  computeOwnCommissionEstimate,
  statementRowFromStored,
  type OwnCommissionCorrectionView,
  type OwnCommissionEstimateProjection,
  type StatementLineHead,
  type StoredStatementLine,
} from '@pospay/commissions-engine';
import type { OwnCommissionEstimate } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CommissionEstimateProviders } from './commission-estimate-providers.ts';
import { readEstimateMonth } from './commission-estimate-readers.ts';

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface OwnEstimateRequest {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly period: string;
}

function correctionWire(correction: OwnCommissionCorrectionView) {
  return {
    kind: correction.kind,
    source_period: correction.sourcePeriod,
    business_date: correction.businessDate,
    service_name_ar: correction.serviceNameAr,
    service_name_en: correction.serviceNameEn,
    previous_amount: correction.previousAmount,
    new_amount: correction.newAmount,
    amount: correction.amount,
  };
}

function estimateWire(projection: OwnCommissionEstimateProjection): OwnCommissionEstimate {
  const corrections = projection.corrections.map(correctionWire);
  if (projection.status === 'APPROVED')
    return { status: 'APPROVED', total: projection.total, corrections };
  if (projection.status === 'ESTIMATE')
    return {
      status: 'ESTIMATE',
      total: projection.total,
      per_line: projection.perLine.map((line) => ({ line_id: line.lineId, amount: line.amount })),
      corrections,
      recalculated: projection.recalculated,
    };
  return { status: projection.status, corrections };
}

/**
 * رؤوس البنود اللي تصحيحات الموظفة بتشير لها: اليوم والخدمة فقط، بلا قراءة العميل أصلًا (CS-Q30).
 * المرجع نص حر في العمود، فبنقبل بس اللي شكله UUID.
 */
async function readCorrectionHeads(
  tx: Tx,
  companyId: string,
  sourceRefs: readonly string[],
): Promise<ReadonlyMap<string, StatementLineHead>> {
  const lineIds = [
    ...new Set(
      sourceRefs
        .filter((ref) => ref.startsWith('line:'))
        .map((ref) => ref.slice(5))
        .filter((id) => UUID_TEXT.test(id)),
    ),
  ].sort();
  const heads = new Map<string, StatementLineHead>();
  if (lineIds.length === 0) return heads;
  const rows = await tx.execute<{
    lineId: string;
    sessionId: string;
    serviceId: string;
    businessDate: string;
  }>(sql`SELECT line_id AS "lineId", session_id AS "sessionId", service_id AS "serviceId",
      business_date::text AS "businessDate"
    FROM commission_line_heads
    WHERE company_id = ${companyId} AND line_id = ANY(${`{${lineIds.join(',')}}`}::uuid[])`);
  for (const row of rows) {
    heads.set(row.lineId, {
      sessionId: row.sessionId,
      serviceId: row.serviceId,
      customerId: null,
      businessDate: row.businessDate,
    });
  }
  return heads;
}

/** صفوف الموظفة وحدها من الكشف المجمّد؛ صفوف الزميلات ما بتتقراش أصلًا. */
async function readFrozenOwnRows(
  tx: Tx,
  request: OwnEstimateRequest,
  statementId: string,
): Promise<StoredStatementLine[]> {
  const rows = await tx.execute<StoredStatementLine & Record<string, unknown>>(sql`SELECT employee_id,
      employee_number, employee_name_ar, employee_name_en, source_ref, kind, amount::text AS amount,
      previous_amount::text AS previous_amount, new_amount::text AS new_amount, source_period,
      source_branch_id, source_branch_name_ar, source_branch_name_en,
      source_business_date::text AS source_business_date, attached_branch_ids, line_id, session_id,
      service_id, service_name_ar, service_name_en, customer_id, customer_name,
      business_date::text AS business_date
    FROM commission_statement_lines
    WHERE company_id = ${request.companyId} AND business_id = ${request.businessId}::uuid
      AND statement_id = ${statementId}::uuid AND employee_id = ${request.employeeId}::uuid
    ORDER BY source_ref`);
  return [...rows];
}

/**
 * قارئ تقدير عمولتي: شهر معتمد أو مصروف بيتقرا من صفوفه المجمّدة، وغيره من الإسقاط الحي.
 *
 * @param serviceNames قارئ أسماء الخدمات من الكتالوج
 * @returns دالة القراءة على معاملة الطلب
 */
export function createOwnCommissionEstimateReader(
  serviceNames: CommissionEstimateProviders['serviceNames'],
) {
  return async (tx: Tx, request: OwnEstimateRequest): Promise<OwnCommissionEstimate> => {
    const [statement] = await tx.execute<{ id: string; status: string }>(sql`SELECT id, status
      FROM commission_statements
      WHERE company_id = ${request.companyId} AND business_id = ${request.businessId}::uuid
        AND period = ${request.period}`);
    if (
      statement !== undefined &&
      (statement.status === 'APPROVED' || statement.status === 'PAID')
    ) {
      const rows = await readFrozenOwnRows(tx, request, statement.id);
      return estimateWire(computeClosedOwnCommissionEstimate(rows.map(statementRowFromStored)));
    }
    const month = await readEstimateMonth(
      tx,
      request.companyId,
      request.businessId,
      request.period,
      request.employeeId,
    );
    const heads = await readCorrectionHeads(
      tx,
      request.companyId,
      month.corrections.map((correction) => correction.sourceRef),
    );
    const names = await serviceNames(tx, request.companyId, request.businessId, [
      ...new Set([...heads.values()].map((head) => head.serviceId)),
    ]);
    return estimateWire(
      computeOwnCommissionEstimate({
        employeeId: request.employeeId,
        period: request.period,
        month,
        correctionLineDetails: heads,
        serviceNames: names,
      }),
    );
  };
}
