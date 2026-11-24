import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type {
  ClosedStatementPayment,
  ClosedStatementRead,
} from '../ports/commission-statement.port.ts';
import { readFrozenStatement } from './approval-freeze.ts';

type PaidColumns = {
  paid_by: string;
  paid_at: string;
  paid_on: string;
  paid_method: ClosedStatementPayment['paidMethod'];
  paid_note: string | null;
};

/**
 * يقرأ صرف كشف PAID: أعمدة الصرف وصف الدفع لكل موظفة مجمّدة، في لقطة القراءة نفسها (FR-037).
 *
 * @param tx معاملة القراءة
 * @param statementId الكشف المدفوع
 * @param paid أعمدة الصرف من صف الكشف
 * @returns بيانات الصرف بشكلها الداخلي
 */
async function readStatementPayment(
  tx: Tx,
  statementId: string,
  paid: PaidColumns,
): Promise<ClosedStatementPayment> {
  const rows = await tx.execute<{
    employee_id: string;
    exact_payable: string;
    paid_amount: string;
  }>(sql`SELECT employee_id, exact_payable::text AS exact_payable, paid_amount::text AS paid_amount
    FROM commission_statement_payments
    WHERE company_id = app_company_id() AND statement_id = ${statementId}::uuid
    ORDER BY employee_id`);
  return {
    paidOn: paid.paid_on,
    paidMethod: paid.paid_method,
    paidNote: paid.paid_note,
    paidAt: paid.paid_at,
    paidBy: paid.paid_by,
    payments: rows.map((row) => ({
      employeeId: row.employee_id,
      exactPayable: row.exact_payable,
      paidAmount: row.paid_amount,
    })),
  };
}

/**
 * يقرأ ما جُمّد عند اعتماد الشهر وما سُجّل عند صرفه: وقت الاعتماد والبصمتان المخزّنتان والصفوف المجمّدة وبيانات
 * الصرف، في لقطة القراءة نفسها (FR-025، FR-037). لا يحسب شيئًا ولا يقرأ مصدرًا حيًا.
 *
 * @param tx معاملة القراءة
 * @param request النشاط والشهر
 * @param request.businessId النشاط
 * @param request.period الشهر بصيغة YYYY-MM
 * @returns الصفوف المجمّدة وبيانات الاعتماد وبيانات الصرف إن وُجدت
 */
export async function readClosedStatement(
  tx: Tx,
  request: { readonly businessId: string; readonly period: string },
): Promise<ClosedStatementRead> {
  const [row] = await tx.execute<
    {
      id: string;
      status: string;
      approved_at: string;
      input_fingerprint: string;
      statement_fingerprint: string;
    } & Partial<PaidColumns>
  >(sql`SELECT id, status,
      to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS approved_at,
      input_fingerprint, statement_fingerprint, paid_by,
      to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
      to_char(paid_on, 'YYYY-MM-DD') AS paid_on, paid_method, paid_note
    FROM commission_statements
    WHERE company_id = app_company_id() AND business_id = ${request.businessId}::uuid
      AND period = ${request.period} AND status IN ('APPROVED', 'PAID')`);
  if (row === undefined) throw new Error('The closed statement disappeared inside one snapshot');
  const frozen = await readFrozenStatement(tx, row.id);
  return {
    approvedAt: row.approved_at,
    inputFingerprint: row.input_fingerprint,
    statementFingerprint: row.statement_fingerprint,
    rows: frozen.rows,
    payment:
      row.status === 'PAID' ? await readStatementPayment(tx, row.id, row as PaidColumns) : null,
  };
}
