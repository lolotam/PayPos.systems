import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { readOwnAttendanceAccess } from '../../identity/index.ts';
import { activeBusinessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';

export interface OwnAttendanceContext {
  companyId: string;
  businessId: string;
  userId: string;
  branchId?: string;
}
const dayAt = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};
export async function ownAttendanceContext(tx: Tx, c: OwnAttendanceContext, now: Date) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: c.businessId }]);
  const business =
    tree?.id === c.companyId ? tree.businesses.find((b) => b.id === c.businessId) : null;
  if (!business) return null;
  const branches = business.branches.filter(
    (b) => b.is_active && (c.branchId === undefined || b.id === c.branchId),
  );
  if (branches.length === 0) return null;
  const dates = branches.map((b) => ({ branch_id: b.id, today: dayAt(now, b.effective_timezone) }));
  const employees = await tx.execute<{ id: string; user_id: string; branch_ids: string[] }>(sql`
    SELECT e.id,e.user_id,array_agg(eb.branch_id) AS branch_ids
    FROM employees e JOIN employee_branches eb ON eb.company_id=e.company_id AND eb.employee_id=e.id
    JOIN jsonb_to_recordset(${JSON.stringify(dates)}::jsonb) AS d(branch_id uuid,today date)
      ON d.branch_id=eb.branch_id
    WHERE e.company_id=${c.companyId} AND e.business_id=${c.businessId}
      AND e.user_id=${c.userId} AND e.deleted_at IS NULL
      AND e.hire_date<=d.today AND (e.contract_end IS NULL OR e.contract_end>=d.today)
      AND eb."from"<=d.today AND (eb."to" IS NULL OR eb."to">d.today)
    GROUP BY e.id,e.user_id`);
  const employee = employees[0];
  if (employees.length !== 1 || !employee) return null;
  const allowed = await readOwnAttendanceAccess(
    tx,
    {
      ...c,
      subjectUserId: employee.user_id,
      branchIds: employee.branch_ids,
    },
    now,
  );
  const branchId = allowed[0];
  if (!branchId) return null;
  const timezone = await activeBusinessTimeZone(tx, c.companyId, c.businessId, branchId);
  return timezone
    ? {
        employeeId: employee.id,
        currentMonth: dayAt(now, timezone).slice(0, 7),
        branches: business.branches.map((b) => ({
          id: b.id,
          name_ar: b.name_ar,
          name_en: b.name_en,
        })),
      }
    : null;
}
