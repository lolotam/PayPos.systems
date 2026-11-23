import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { ClosedStatementRead } from '../ports/commission-statement.port.ts';
import { readFrozenStatement } from './approval-freeze.ts';

/**
 * يقرأ ما جُمّد عند اعتماد الشهر: وقت الاعتماد والبصمتان المخزّنتان والصفوف المجمّدة، في لقطة القراءة نفسها (FR-025).
 * لا يحسب شيئًا ولا يقرأ مصدرًا حيًا.
 *
 * @param tx معاملة القراءة
 * @param request النشاط والشهر
 * @param request.businessId النشاط
 * @param request.period الشهر بصيغة YYYY-MM
 * @returns الصفوف المجمّدة وبيانات الاعتماد
 */
export async function readClosedStatement(
  tx: Tx,
  request: { readonly businessId: string; readonly period: string },
): Promise<ClosedStatementRead> {
  const [row] = await tx.execute<{
    id: string;
    approved_at: string;
    input_fingerprint: string;
    statement_fingerprint: string;
  }>(sql`SELECT id,
      to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS approved_at,
      input_fingerprint, statement_fingerprint
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
  };
}
