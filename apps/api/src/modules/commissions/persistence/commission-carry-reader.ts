import { parseCarryKind, type IncomingCommissionCarry } from '@pospay/commissions-engine';
import { parseMoney } from '@pospay/domain';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

type CarryRow = {
  employeeId: string;
  kind: string;
  amount: string;
  sourceStatementId: string;
  sourcePeriod: string;
  targetPeriod: string;
};

/**
 * يقرأ المرحّلات اللي كشفها الهدف هو شهر النشاط ده (D-22)، كلها مهما كان شهر مصدرها: اعتماد
 * أكتوبر المتأخر ممكن يرحّل لديسمبر. الفلترة بشهر الهدف بالظبط زي الفلترة بكشف الهدف، لأن المفتاح
 * المركّب (الشركة، النشاط، الشهر، الكشف) بيضمن إنهم نفس الصف، من غير ما نحتاج صف كشف ولا قفل ولا
 * كتابة في معاملة القراءة الواحدة (D-25). المرحّل بيعدّي من غير تسعير، ونوعه بيتحقق منه
 * (`parseCarryKind`): نوع غريب بيرمي بدل ما يتحسب بقشيش كارت.
 *
 * @param tx معاملة القراءة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @param period شهر الهدف بصيغة YYYY-MM
 * @param employeeId موظفة واحدة اختيارياً؛ من غيرها كل موظفات النشاط
 * @returns المرحّلات الداخلة للشهر، مرتبة بالموظفة ثم كشف المصدر ثم النوع
 */
export async function readIncomingCarries(
  tx: Tx,
  companyId: string,
  businessId: string,
  period: string,
  employeeId: string | null,
): Promise<IncomingCommissionCarry[]> {
  const rows = await tx.execute<CarryRow>(sql`SELECT
    employee_id AS "employeeId", kind AS "kind", amount::text AS "amount",
    source_statement_id AS "sourceStatementId", source_period AS "sourcePeriod",
    target_period AS "targetPeriod"
    FROM commission_carries
    WHERE company_id = ${companyId} AND business_id = ${businessId}::uuid
      AND target_period = ${period}
      ${employeeId === null ? sql`` : sql`AND employee_id = ${employeeId}::uuid`}
    ORDER BY employee_id, source_statement_id, kind`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    kind: parseCarryKind(row.kind),
    amount: parseMoney(row.amount),
    sourceStatementId: row.sourceStatementId,
    sourcePeriod: row.sourcePeriod,
    targetPeriod: row.targetPeriod,
  }));
}
