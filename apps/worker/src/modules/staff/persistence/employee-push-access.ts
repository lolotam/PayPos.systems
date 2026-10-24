import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { activeMembership } from '../../identity/index.ts';
import type { LockedShift } from '../ports/not-clocked-in.port.ts';

/**
 * فروع الموظفة في يوم العمل: فرعها الأساسي شاملاً، وارتباطاتها النشطة في النهار ده.
 * القاعدة هي قاعدة الجلسة الشخصية: العضوية لازم تغطّي أي فرع منهم (ADR-0052 §5).
 */
export function employeeBranchesStatement(
  companyId: string,
  employeeId: string,
  workingDate: string,
) {
  return sql`SELECT primary_branch_id AS branch_id FROM employees
      WHERE company_id = ${companyId} AND id = ${employeeId}
    UNION
    SELECT branch_id FROM employee_branches
      WHERE company_id = ${companyId} AND employee_id = ${employeeId}
        AND "from" <= ${workingDate}::date AND ("to" IS NULL OR "to" > ${workingDate}::date)`;
}

// الموظفة ليها حساب بس عضويتها في الشركة انتهت أو مغطّاش نطاقها: مفيش إشعار يوصلها (ADR-0052 §5).
// فروعها تُقرأ من جداول staff نفسها على نفس المعاملة، من غير اتصال جديد.
export async function userHasAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  shift: LockedShift,
  at: Date,
): Promise<boolean> {
  const rows = await tx.execute<{ branch_id: string }>(
    employeeBranchesStatement(companyId, shift.employeeId, shift.workingDate),
  );
  return activeMembership(tx, companyId, userId, at, {
    businessId: shift.businessId,
    branchIds: rows.map((row) => row.branch_id),
  });
}
