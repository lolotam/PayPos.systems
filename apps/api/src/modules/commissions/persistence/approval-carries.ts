import type { IdGenerator, Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import type { CarryWrite, ShareCheckLine } from '../ports/commission-statement-approve.port.ts';

/**
 * يكتب مرحّلات الأرصدة السالبة لكشف المصدر، صفًا لكل نوع وموظفة (D-22). القيد الفريد على (كشف المصدر، الموظفة، النوع)
 * يمنع كتابتها مرتين، فإعادة اعتماد غير ممكنة أصلًا لأن الكشف لم يعد REVIEWED.
 *
 * @param tx معاملة الاعتماد
 * @param ids مولّد معرّفات الصفوف
 * @param businessId النشاط
 * @param statementId كشف المصدر الذي اعتُمد
 * @param period شهر المصدر
 * @param carries المرحّلات وأهدافها
 */
export async function insertApprovalCarries(
  tx: Tx,
  ids: IdGenerator,
  businessId: string,
  statementId: string,
  period: string,
  carries: readonly CarryWrite[],
): Promise<void> {
  for (const carry of carries) {
    await tx.execute(sql`INSERT INTO commission_carries (company_id, id, business_id, employee_id, kind, amount,
        source_statement_id, source_period, target_period, target_statement_id)
      VALUES (app_company_id(), ${ids.newId()}::uuid, ${businessId}::uuid, ${carry.employeeId}::uuid, ${carry.kind},
        ${moneyToString(carry.amount)}::numeric, ${statementId}::uuid, ${period}, ${carry.targetPeriod},
        ${carry.targetStatementId}::uuid)`);
  }
}

/**
 * يقرأ حصص مؤدي كل بند في شهر الكشف من إسقاط العمولة نفسه الذي يبني الكشف، لفحص D-14 الدفاعي: الحالة تأتي من رأس
 * البند وحصة كل مؤدية من صفها.
 *
 * @param tx معاملة الاعتماد
 * @param businessId النشاط
 * @param period الشهر بصيغة YYYY-MM
 * @returns صف لكل مؤدية في كل بند
 */
export async function readApprovalLineShares(
  tx: Tx,
  businessId: string,
  period: string,
): Promise<readonly ShareCheckLine[]> {
  const rows = await tx.execute<{ lineId: string; status: string; shareBps: number }>(sql`SELECT
      l.line_id AS "lineId", h.status AS "status", l.share_bps AS "shareBps"
    FROM commission_lines l
    JOIN commission_line_heads h ON h.company_id = l.company_id AND h.line_id = l.line_id
    WHERE l.company_id = app_company_id() AND l.business_id = ${businessId}::uuid AND l.period = ${period}
    ORDER BY l.line_id, l.employee_id`);
  return rows.map((row) => ({
    lineId: row.lineId,
    status: row.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    shareBps: BigInt(row.shareBps),
  }));
}
