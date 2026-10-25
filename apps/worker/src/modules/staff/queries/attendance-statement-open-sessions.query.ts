import type { Tx } from '@pospay/db';
import type { AttendanceOpenSession } from '@pospay/domain';
import { sql } from 'drizzle-orm';

/**
 * جلسات الموظفة المفتوحة في الفترة: يوم العمل ودخول البصمة بس.
 * جملة تقرير 27b بتسيب الجلسات المفتوحة بره (AB-Q9g)، وبيان الموظفة بيقراها بنفسه (FR-011a).
 */
export function attendanceStatementOpenSessionsStatement(
  companyId: string,
  branchId: string,
  employeeId: string,
  from: string,
  to: string,
) {
  return sql`SELECT working_date::text AS working_date, clock_in
    FROM attendance_sessions
    WHERE company_id = ${companyId} AND company_id = app_company_id()
      AND branch_id = ${branchId}::uuid AND employee_id = ${employeeId}::uuid
      AND status = 'OPEN' AND voided_at IS NULL
      AND working_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY clock_in`;
}

/**
 * يقرأ الجلسات المفتوحة غير الملغاة للموظفة في الفرع والفترة، ويرجّعها بالشكل اللي
 * بيحتاجه حساب أيام البيان: يوم العمل ودخول البصمة بلغة ISO.
 *
 * @param tx معاملة الشركة المفتوحة
 * @param companyId الشركة
 * @param branchId الفرع
 * @param employeeId الموظفة
 * @param from أول يوم عمل في الفترة
 * @param to آخر يوم عمل في الفترة
 * @returns الجلسات المفتوحة مرتبة بدخول البصمة
 */
export async function attendanceStatementOpenSessions(
  tx: Tx,
  companyId: string,
  branchId: string,
  employeeId: string,
  from: string,
  to: string,
): Promise<AttendanceOpenSession[]> {
  const rows = await tx.execute<{ working_date: string; clock_in: Date | string }>(
    attendanceStatementOpenSessionsStatement(companyId, branchId, employeeId, from, to),
  );
  return rows.map((row) => ({
    working_date: row.working_date,
    clock_in: new Date(row.clock_in).toISOString(),
  }));
}
