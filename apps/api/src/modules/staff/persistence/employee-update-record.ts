import type { Tx } from '@pospay/db';
import { employeeDetailRecord, type EmployeeDetail } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type { BranchAttachment } from '../domain/update-employee.ts';

export async function lockedEmployee(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<{ record: EmployeeDetail; history: readonly BranchAttachment[] } | null> {
  const [row] =
    await tx.execute(sql`SELECT id,business_id,primary_branch_id,name_ar,name_en,role_code,user_id,
    to_char(hire_date,'YYYY-MM-DD') AS hire_date,to_char(contract_end,'YYYY-MM-DD') AS contract_end,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,revision
    FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (row === undefined) return null;
  const history = await tx.execute<{
    id: string;
    branchId: string;
    from: string;
    to: string | null;
  }>(sql`SELECT id,branch_id AS "branchId",to_char("from",'YYYY-MM-DD') AS "from",to_char("to",'YYYY-MM-DD') AS "to"
    FROM employee_branches WHERE company_id=${companyId} AND employee_id=${employeeId} ORDER BY branch_id,"from"`);
  const active = history.filter((row) => row.to === null);
  return {
    record: employeeDetailRecord.parse({ ...row, branch_ids: active.map((r) => r.branchId) }),
    history,
  };
}
