import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يثبت الموظف المرتبط بالمستخدم وأهلية فروعه الحالية؛ التاريخ المعروض لا يتقيد بهذه الفروع.
 *
 * @param tx معاملة القراءة المشتركة
 * @param context هوية الجلسة والفروع الفعالة بتوقيتها من tenancy
 * @param now عينة الساعة المشتركة
 * @returns موظف واحد مؤهل وفروعه الحالية أو null
 */
export async function readOwnEmployee(
  tx: Tx,
  context: {
    companyId: string;
    businessId: string;
    userId: string;
    branches: readonly { id: string; effective_timezone: string }[];
  },
  now: Date,
) {
  const dates = context.branches.map((branch) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: branch.effective_timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { branch_id: branch.id, today: `${part('year')}-${part('month')}-${part('day')}` };
  });
  const rows = await tx.execute<{ employee_id: string; user_id: string; branch_ids: string[] }>(sql`
    SELECT e.id AS employee_id,e.user_id,array_agg(eb.branch_id) AS branch_ids
    FROM employees e JOIN employee_branches eb ON eb.company_id=e.company_id AND eb.employee_id=e.id
    JOIN jsonb_to_recordset(${JSON.stringify(dates)}::jsonb) AS d(branch_id uuid,today date)
      ON d.branch_id=eb.branch_id
    WHERE e.company_id=${context.companyId} AND e.business_id=${context.businessId}
      AND e.user_id=${context.userId} AND e.deleted_at IS NULL
      AND e.hire_date<=d.today AND (e.contract_end IS NULL OR e.contract_end>=d.today)
      AND eb."from"<=d.today AND (eb."to" IS NULL OR eb."to">d.today)
    GROUP BY e.id,e.user_id`);
  const employee = rows[0];
  return rows.length === 1 && employee
    ? { employeeId: employee.employee_id, userId: employee.user_id, branchIds: employee.branch_ids }
    : null;
}
